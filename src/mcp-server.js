const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const db = require("./db");

const server = new McpServer({
  name: "book-api",
  version: "1.0.0",
});

const VALID_STATUSES = ["to-read", "reading", "read"];
const VALID_GENRES = [
  "fiction", "sci-fi", "fantasy", "history", "biography",
  "science", "philosophy", "non-fiction", "mystery", "self-help",
];

// list_books — List/filter books
server.tool(
  "list_books",
  "List books in the collection. Optionally filter by status, genre, or author.",
  {
    status: z.enum(VALID_STATUSES).optional().describe("Filter by reading status"),
    genre: z.enum(VALID_GENRES).optional().describe("Filter by genre"),
    author: z.string().optional().describe("Filter by author (partial match)"),
  },
  async ({ status, genre, author }) => {
    let sql = "SELECT * FROM books";
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (genre) {
      conditions.push("genre = ?");
      params.push(genre);
    }
    if (author) {
      conditions.push("author LIKE ?");
      params.push(`%${author}%`);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY date_added DESC";

    const books = db.prepare(sql).all(...params);
    return { content: [{ type: "text", text: JSON.stringify(books, null, 2) }] };
  }
);

// get_book — Get a book by ID
server.tool(
  "get_book",
  "Get a single book by its ID.",
  { id: z.number().int().positive().describe("Book ID") },
  async ({ id }) => {
    const book = db.prepare("SELECT * FROM books WHERE id = ?").get(id);
    if (!book) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Book not found" }) }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
  }
);

// add_book — Add a new book
server.tool(
  "add_book",
  "Add a new book to the collection.",
  {
    title: z.string().min(1).describe("Book title"),
    author: z.string().min(1).describe("Book author"),
    genre: z.enum(VALID_GENRES).optional().describe("Book genre"),
    rating: z.number().int().min(1).max(5).optional().describe("Rating 1-5"),
    status: z.enum(VALID_STATUSES).optional().default("to-read").describe("Reading status"),
    pages: z.number().int().positive().optional().describe("Number of pages"),
    notes: z.string().optional().describe("Personal notes"),
  },
  async ({ title, author, genre, rating, status, pages, notes }) => {
    const date_added = new Date().toISOString().split("T")[0];
    const date_finished = status === "read" ? date_added : null;

    const stmt = db.prepare(`
      INSERT INTO books (title, author, genre, rating, status, pages, date_added, date_finished, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title.trim(), author.trim(),
      genre ?? null, rating ?? null, status, pages ?? null,
      date_added, date_finished, notes ?? null
    );

    const book = db.prepare("SELECT * FROM books WHERE id = ?").get(result.lastInsertRowid);
    return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
  }
);

// update_book — Partial update a book
server.tool(
  "update_book",
  "Update an existing book. Only provided fields are changed. Automatically sets date_finished when status changes to 'read'.",
  {
    id: z.number().int().positive().describe("Book ID"),
    title: z.string().min(1).optional().describe("Book title"),
    author: z.string().min(1).optional().describe("Book author"),
    genre: z.enum(VALID_GENRES).optional().describe("Book genre"),
    rating: z.number().int().min(1).max(5).optional().describe("Rating 1-5"),
    status: z.enum(VALID_STATUSES).optional().describe("Reading status"),
    pages: z.number().int().positive().optional().describe("Number of pages"),
    notes: z.string().optional().describe("Personal notes"),
  },
  async ({ id, title, author, genre, rating, status, pages, notes }) => {
    const existing = db.prepare("SELECT * FROM books WHERE id = ?").get(id);
    if (!existing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Book not found" }) }],
        isError: true,
      };
    }

    const updated = {
      title: title ?? existing.title,
      author: author ?? existing.author,
      genre: genre !== undefined ? genre : existing.genre,
      rating: rating !== undefined ? rating : existing.rating,
      status: status ?? existing.status,
      pages: pages !== undefined ? pages : existing.pages,
      date_finished: existing.date_finished,
      notes: notes !== undefined ? notes : existing.notes,
    };

    // Auto-set date_finished when status transitions to "read"
    if (status === "read" && existing.status !== "read") {
      updated.date_finished = new Date().toISOString().split("T")[0];
    }

    db.prepare(`
      UPDATE books
      SET title = ?, author = ?, genre = ?, rating = ?, status = ?,
          pages = ?, date_finished = ?, notes = ?
      WHERE id = ?
    `).run(
      updated.title, updated.author, updated.genre, updated.rating,
      updated.status, updated.pages, updated.date_finished, updated.notes,
      id
    );

    const book = db.prepare("SELECT * FROM books WHERE id = ?").get(id);
    return { content: [{ type: "text", text: JSON.stringify(book, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
