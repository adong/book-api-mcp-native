const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { GENRES, STATUSES, TRANSITIONS } = require("./config");
const service = require("./services/book-service");

const server = new McpServer({
  name: "book-api",
  version: "2.0.0",
});

function reply(result) {
  const payload = result.ok
    ? { ...result.data, ...(result.suggestion ? { _suggestion: result.suggestion } : {}) }
    : { error: result.error, recovery: result.recovery };

  // For arrays, wrap differently
  const text = Array.isArray(result.data)
    ? JSON.stringify(result.ok ? result.data : payload, null, 2)
    : JSON.stringify(payload, null, 2);

  return { content: [{ type: "text", text }], isError: !result.ok };
}

// --- CRUD Tools ---

server.tool(
  "list_books",
  "List books in your collection. Use filters to narrow results — e.g. see what you're currently reading, browse a genre, or find books by a specific author.",
  {
    status: z.enum(STATUSES).optional().describe("Filter by reading status (to-read, reading, read)"),
    genre: z.enum(GENRES).optional().describe("Filter by genre"),
    author: z.string().optional().describe("Filter by author name (partial match)"),
  },
  async (params) => reply(service.listBooks(params))
);

server.tool(
  "get_book",
  "Get full details for a specific book by ID. If the book isn't found, the error will suggest how to find the right ID.",
  { id: z.number().int().positive().describe("Book ID") },
  async ({ id }) => reply(service.getBook(id))
);

server.tool(
  "add_book",
  "Add a new book to the collection. Defaults to 'to-read' status. After adding, you'll get a suggestion for what to do next.",
  {
    title: z.string().min(1).describe("Book title"),
    author: z.string().min(1).describe("Book author"),
    genre: z.enum(GENRES).optional().describe("Book genre"),
    rating: z.number().int().min(1).max(5).optional().describe("Rating 1-5 (usually set when finishing)"),
    status: z.enum(STATUSES).optional().default("to-read").describe("Initial reading status"),
    pages: z.number().int().positive().optional().describe("Number of pages"),
    notes: z.string().optional().describe("Personal notes about the book"),
  },
  async (params) => reply(service.addBook(params))
);

server.tool(
  "update_book",
  "Update fields on an existing book. Only provided fields are changed. Status changes are validated — e.g. you can't jump from 'to-read' to 'read' without reading first. Prefer start_reading/finish_book for status changes.",
  {
    id: z.number().int().positive().describe("Book ID"),
    title: z.string().min(1).optional().describe("New title"),
    author: z.string().min(1).optional().describe("New author"),
    genre: z.enum(GENRES).optional().describe("New genre"),
    rating: z.number().int().min(1).max(5).optional().describe("New rating 1-5"),
    status: z.enum(STATUSES).optional().describe("New status (validated transition)"),
    pages: z.number().int().positive().optional().describe("New page count"),
    notes: z.string().optional().describe("New notes"),
  },
  async ({ id, ...fields }) => reply(service.updateBook(id, fields))
);

// --- Intent Tools ---

server.tool(
  "start_reading",
  "Mark a 'to-read' book as 'reading'. Simpler than update_book for this common action — just provide the book ID.",
  { id: z.number().int().positive().describe("Book ID to start reading") },
  async ({ id }) => reply(service.startReading(id))
);

server.tool(
  "finish_book",
  "Mark a book you're reading as 'read'. Automatically sets today's date as finish date. Optionally add a rating and notes. Returns your updated reading stats.",
  {
    id: z.number().int().positive().describe("Book ID to finish"),
    rating: z.number().int().min(1).max(5).optional().describe("Your rating 1-5"),
    notes: z.string().optional().describe("Final thoughts or notes"),
  },
  async ({ id, ...opts }) => reply(service.finishBook(id, opts))
);

server.tool(
  "search_books",
  "Fuzzy search across book titles, authors, and notes. Use when the user describes a book vaguely — e.g. 'that genetics book' or 'something by Harari'.",
  { query: z.string().min(1).describe("Search term (searches title, author, and notes)") },
  async ({ query }) => reply(service.searchBooks(query))
);

// --- Intelligence Tools ---

server.tool(
  "get_reading_stats",
  "Get a reading dashboard: total books, books read, currently reading, average rating, and genre breakdown with per-genre averages. Great for answering 'how am I doing?' questions.",
  {},
  async () => reply(service.getReadingStats())
);

server.tool(
  "get_capabilities",
  "List all available tools, valid genres, statuses, and allowed status transitions. Call this when you need to know what actions are possible.",
  {},
  async () => reply(service.getCapabilities())
);

// ============================================================
// Phase 2: AI-Native — Resources, Prompts, State-aware responses
// ============================================================

// --- MCP Resources (passive data — no tool call needed) ---

server.resource(
  "schema",
  "bookshelf://schema",
  { description: "Data model, valid genres/statuses/transitions, and field descriptions", mimeType: "application/json" },
  async () => ({
    contents: [{
      uri: "bookshelf://schema",
      mimeType: "application/json",
      text: JSON.stringify({
        fields: {
          id: { type: "integer", description: "Auto-generated unique ID" },
          title: { type: "string", required: true, description: "Book title" },
          author: { type: "string", required: true, description: "Book author" },
          genre: { type: "enum", values: GENRES, description: "Book genre classification" },
          rating: { type: "integer", range: [1, 5], description: "Personal rating (usually set when finishing)" },
          status: { type: "enum", values: STATUSES, default: "to-read", description: "Reading status" },
          pages: { type: "integer", min: 1, description: "Number of pages" },
          date_added: { type: "date", description: "Date the book was added (auto-set)" },
          date_finished: { type: "date", description: "Date the book was finished (auto-set when status becomes read)" },
          notes: { type: "string", description: "Personal notes or review" },
        },
        statuses: STATUSES,
        genres: GENRES,
        transitions: TRANSITIONS,
        transitionNotes: {
          "to-read → reading": "Use start_reading tool",
          "reading → read": "Use finish_book tool (auto-sets date_finished)",
          "reading → to-read": "Use update_book to move back to queue",
          "read → to-read": "Use update_book to re-read later",
        },
      }, null, 2),
    }],
  })
);

server.resource(
  "stats",
  "bookshelf://stats",
  { description: "Live reading statistics — totals, averages, genre breakdown", mimeType: "application/json" },
  async () => {
    const result = service.getReadingStats();
    return {
      contents: [{
        uri: "bookshelf://stats",
        mimeType: "application/json",
        text: JSON.stringify(result.data, null, 2),
      }],
    };
  }
);

server.resource(
  "currently-reading",
  "bookshelf://currently-reading",
  { description: "Books currently being read", mimeType: "application/json" },
  async () => {
    const result = service.listBooks({ status: "reading" });
    return {
      contents: [{
        uri: "bookshelf://currently-reading",
        mimeType: "application/json",
        text: JSON.stringify(result.data, null, 2),
      }],
    };
  }
);

// --- MCP Prompts (pre-built workflows) ---

server.prompt(
  "monthly-review",
  "Generate a reading summary for a given month. Includes books finished, ratings, and stats context.",
  { month: z.string().describe("Month in YYYY-MM format, e.g. 2026-01") },
  async ({ month }) => {
    const stats = service.getReadingStats();
    const allBooks = service.listBooks({ status: "read" });
    const booksThisMonth = allBooks.ok
      ? allBooks.data.filter(b => b.date_finished && b.date_finished.startsWith(month))
      : [];

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Generate a monthly reading review for ${month}.`,
            "",
            `Books finished this month (${booksThisMonth.length}):`,
            JSON.stringify(booksThisMonth, null, 2),
            "",
            "Overall stats:",
            JSON.stringify(stats.data, null, 2),
            "",
            "Please provide:",
            "1. A summary of what was read this month",
            "2. Highlights and patterns (genres, ratings)",
            "3. Comparison to overall reading habits",
            "4. A suggestion for next month",
          ].join("\n"),
        },
      }],
    };
  }
);

server.prompt(
  "recommend-next",
  "Suggest the next book to read based on reading history and optional mood/preference.",
  { mood: z.string().optional().describe("Current mood or what you're in the mood for, e.g. 'something light', 'mind-bending sci-fi'") },
  async ({ mood }) => {
    const stats = service.getReadingStats();
    const toRead = service.listBooks({ status: "to-read" });
    const readBooks = service.listBooks({ status: "read" });

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            "Recommend which book I should read next.",
            "",
            mood ? `Current mood/preference: ${mood}` : "No specific mood — suggest based on my patterns.",
            "",
            `Books on my to-read list (${toRead.ok ? toRead.data.length : 0}):`,
            JSON.stringify(toRead.ok ? toRead.data : [], null, 2),
            "",
            `Books I've already read (${readBooks.ok ? readBooks.data.length : 0}):`,
            JSON.stringify(readBooks.ok ? readBooks.data : [], null, 2),
            "",
            "Reading stats:",
            JSON.stringify(stats.data, null, 2),
            "",
            "Please:",
            "1. Pick one book from the to-read list (or suggest a new one)",
            "2. Explain why it's a good fit based on my reading history",
            "3. If relevant, note how it relates to books I've enjoyed",
          ].join("\n"),
        },
      }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
