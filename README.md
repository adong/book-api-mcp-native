# Book API — From REST to AI-Native MCP Server

A personal book collection tracker that evolved through three architectural stages. This README documents the full progression, the trade-offs at each level, and exactly what changed between them.

## Table of Contents

- [Quick Start](#quick-start)
- [The Three Stages](#the-three-stages)
- [Stage 1: Traditional REST API](#stage-1-traditional-rest-api)
- [Stage 2: AI-Using (MCP Bolt-On)](#stage-2-ai-using-mcp-bolt-on)
- [Stage 3: AI-Native (Service + Resources + Prompts)](#stage-3-ai-native-service--resources--prompts)
- [Detailed File Walkthrough](#detailed-file-walkthrough)
- [What the LLM Sees at Each Stage](#what-the-llm-sees-at-each-stage)
- [Trade-Off Analysis](#trade-off-analysis)
- [Architecture Comparison](#architecture-comparison)
- [The Skill Layer](#the-skill-layer)
- [The Progression in Numbers](#the-progression-in-numbers)

---

## Quick Start

```bash
npm install
npm run seed    # populate SQLite with 15 sample books
npm start       # REST API on http://localhost:3000
npm run mcp     # MCP server over stdio
```

---

## The Three Stages

```
Stage 1: REST API          Stage 2: AI-Using         Stage 3: AI-Native
(commit 6796772)           (commit b082a6e)          (commit 090f890)

┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│   Express    │          │   Express    │          │   Express    │
│   routes     │──┐       │   routes     │──┐       │   routes     │──┐
│  (146 lines) │  │       │  (146 lines) │  │       │  (31 lines)  │  │
└──────────────┘  │       └──────────────┘  │       └──────────────┘  │
                  ▼                         ▼              │          ▼
            ┌──────────┐             ┌──────────┐          │    ┌──────────┐
            │  SQLite  │             │  SQLite  │          │    │  SQLite  │
            │   (db)   │             │   (db)   │          │    │   (db)   │
            └──────────┘             └──────────┘          │    └──────────┘
                                          ▲                │          ▲
                                          │                ▼          │
                                    ┌──────────┐    ┌────────────┐   │
                                    │   MCP    │    │  Service   │───┘
                                    │  server  │    │   Layer    │
                                    │(164 lines)│    │ (241 lines)│
                                    │ 4 tools  │    └────────────┘
                                    └──────────┘          ▲
                                                          │
                                                    ┌──────────┐
                                                    │   MCP    │
                                                    │  server  │
                                                    │(275 lines)│
                                                    │ 9 tools  │
                                                    │3 resources│
                                                    │ 2 prompts│
                                                    └──────────┘
```

---

## Stage 1: Traditional REST API

**Commit:** `6796772` — `init with restful api`

A standard Express CRUD API. No AI awareness at all.

### What Exists

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.js` | 33 | Express app, middleware, error handling |
| `src/routes/books.js` | 146 | All business logic + HTTP handling combined |
| `src/db.js` | 25 | SQLite connection + schema with hardcoded enums |
| `src/seed.js` | 191 | 15 sample books across all statuses |

### Endpoints

```
GET    /api/books          List/filter books (?status=, ?genre=, ?author=)
GET    /api/books/:id      Get single book
POST   /api/books          Create book
PUT    /api/books/:id      Partial update (merge-style)
GET    /api/health         Health check
```

### How It Works

The routes file does everything: validation, SQL queries, date logic, error formatting. The "smart" behavior is minimal — the only automatic thing is setting `date_finished` when status changes to `read`.

```js
// routes/books.js — validation is inline, coupled to HTTP layer
function validateBook(body, isUpdate = false) {
  const errors = [];
  if (!isUpdate) {
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      errors.push('title is required');
    }
    // ... 30 more lines of checks
  }
  return errors;
}
```

### Problems That Become Obvious When You Add AI

1. **Hardcoded enums in 2 places** — `routes/books.js` and `db.js` each define their own genre/status lists. Add a genre? Edit two files and hope you don't miss one.
2. **No state transition rules** — nothing stops you from going `to-read` -> `read` directly. The LLM has to "know" this is wrong.
3. **Error messages are for humans, not LLMs** — `{ error: "Book not found" }` tells the LLM nothing about what to do next.
4. **No business logic layer** — validation, queries, and HTTP are all tangled in one file. Can't reuse from a second interface (like MCP).

### Trade-Offs at This Stage

| Pros | Cons |
|------|------|
| Simple, minimal code | Business logic locked inside HTTP layer |
| Easy to understand linearly | Enums duplicated across files |
| Standard REST patterns | No reusability for non-HTTP consumers |
| Fast to build | Errors don't guide the caller |
| No abstractions to learn | No state machine — invalid transitions possible |

---

## Stage 2: AI-Using (MCP Bolt-On)

**Commit:** `b082a6e` — `ai use`

Added an MCP server alongside the existing REST API. The MCP server talks directly to SQLite — it's essentially a copy-paste of the route logic adapted for MCP's tool format.

### What Changed from Stage 1

| Change | Detail |
|--------|--------|
| **New file:** `src/mcp-server.js` | 164 lines, 4 tools |
| **New deps:** `@modelcontextprotocol/sdk`, `zod` | MCP protocol + schema validation |
| **New script:** `npm run mcp` | Runs MCP server over stdio |
| Routes, db, seed | **Unchanged** |

### The 4 MCP Tools

```
list_books    — same query as GET /api/books, re-implemented
get_book      — same as GET /api/books/:id, re-implemented
add_book      — same as POST /api/books, re-implemented
update_book   — same as PUT /api/books/:id, re-implemented
```

### What the AI-Using MCP Server Looks Like

Every tool is a self-contained mini-handler that duplicates the route logic:

```js
// mcp-server.js (AI-Using) — each tool has its own SQL + logic
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

    if (status) { conditions.push("status = ?"); params.push(status); }
    if (genre)  { conditions.push("genre = ?");  params.push(genre);  }
    if (author) { conditions.push("author LIKE ?"); params.push(`%${author}%`); }

    if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY date_added DESC";

    const books = db.prepare(sql).all(...params);
    return { content: [{ type: "text", text: JSON.stringify(books, null, 2) }] };
  }
);
```

### The Duplication Problem

At this point, enums exist in **three places**:

| Location | Genres defined | Statuses defined |
|----------|---------------|-----------------|
| `src/db.js` (SQL CHECK) | Yes (hardcoded string) | Yes (hardcoded string) |
| `src/routes/books.js` | Yes (`VALID_GENRES` array) | Yes (`VALID_STATUSES` array) |
| `src/mcp-server.js` | Yes (`VALID_GENRES` array) | Yes (`VALID_STATUSES` array) |

Adding a new genre means editing three files. This is the classic "bolt-on" problem — you added a second interface without refactoring the shared logic out first.

### The LLM's Burden

The LLM has to carry all the intelligence. To "finish a book" it must:

1. Know to call `update_book` (not obvious from tool names)
2. Know to set `status: "read"`
3. Know that `date_finished` gets auto-set (can't see this from the tool description)
4. Know to add a rating at the same time
5. Know not to transition from `to-read` directly to `read`

If it gets step 5 wrong, the error is `{ error: "Book not found" }` or a raw SQLite constraint error — no guidance on what went wrong or how to fix it.

### Error Response Comparison

```json
// AI-Using: unhelpful error
{ "error": "Book not found" }

// AI-Using: validation errors are bare arrays
{ "errors": ["status must be one of: to-read, reading, read"] }
```

The LLM gets the error, but has no machine-readable guidance on what to try next.

### Trade-Offs at This Stage

| Pros | Cons |
|------|------|
| LLM can now interact via MCP tools | Logic duplicated across REST + MCP |
| Zod schemas give type safety to tool inputs | Enums hardcoded in 3 separate places |
| Works — LLM can CRUD books | LLM must compose multi-step workflows manually |
| Minimal changes to existing code | No intent-based tools (start_reading, finish_book) |
| Quick to add | Error messages don't guide recovery |
| | No search capability |
| | No stats or intelligence tools |
| | Tool descriptions say "what" not "when" or "why" |

---

## Stage 3: AI-Native (Service + Resources + Prompts)

**Commit:** `090f890` — `Bridge book-api from AI-Using to AI-Native`

Complete restructure. Extracted a service layer, added intent-based tools, MCP resources for passive context, and MCP prompts for pre-built workflows.

### What Changed from Stage 2

| Change | Detail |
|--------|--------|
| **New:** `src/config.js` | 18 lines — single source of truth for all enums + transitions |
| **New:** `src/services/book-service.js` | 241 lines — all business logic extracted |
| **Rewritten:** `src/routes/books.js` | 146 -> 31 lines — thin HTTP adapter |
| **Rewritten:** `src/mcp-server.js` | 164 -> 275 lines — 9 tools + 3 resources + 2 prompts |
| **Updated:** `src/db.js` | Dynamic CHECK constraints from config |

### Phase 1 Changes (AI-Accessible)

#### `src/config.js` — Single Source of Truth

Before: three files each had their own genre and status arrays. Now:

```js
const GENRES = [
  'fiction', 'sci-fi', 'fantasy', 'history', 'biography',
  'science', 'philosophy', 'non-fiction', 'mystery', 'self-help', 'instructional',
];

const STATUSES = ['to-read', 'reading', 'read'];

const TRANSITIONS = {
  'to-read': ['reading'],
  'reading': ['read', 'to-read'],
  'read': ['to-read'],
};

function today() {
  return new Date().toISOString().split('T')[0];
}
```

**Key addition: `TRANSITIONS`.** This is the state machine. Before, there were no rules — any status could change to any other. Now:

```
to-read  ──>  reading
reading  ──>  read  (or back to to-read)
read     ──>  to-read  (re-read)
```

You cannot skip from `to-read` directly to `read`. The service layer enforces this.

#### `src/services/book-service.js` — The Brain

Every function returns a structured result:

```js
// Success
{ ok: true, data: { ... }, suggestion: "Use finish_book when done." }

// Failure
{ ok: false, error: "Cannot transition from 'to-read' to 'read'", recovery: "Use start_reading first" }
```

This is the biggest architectural change. Both REST and MCP consume the same service. The service is the single owner of:

- **Validation** — field types, enum membership, required fields
- **State transitions** — enforced via the `TRANSITIONS` map
- **Date logic** — `date_finished` auto-set when status becomes `read`
- **Error formatting** — every error includes a `recovery` hint

**Query operations:**

```js
listBooks({ status, genre, author })  // Filter with pre-validated enums
getBook(id)                           // With "Use list_books to find IDs" recovery
searchBooks(query)                    // Fuzzy LIKE across title/author/notes
```

**Mutations with validation:**

```js
addBook({ title, author, ... })       // Returns suggestion: "Use start_reading when you begin"
updateBook(id, fields)                // Enforces state transitions
```

**Intent operations** (the biggest win for AI):

```js
startReading(id)                      // One call. Validates state. Returns next action.
finishBook(id, { rating, notes })     // One call. Auto-dates. Returns stats summary.
```

**Intelligence:**

```js
getReadingStats()                     // Totals, averages, genre breakdown, currently reading
getCapabilities()                     // Self-describing tool catalog
```

#### `src/db.js` — Dynamic Constraints

Before (hardcoded):
```sql
genre TEXT CHECK(genre IN ('fiction','sci-fi','fantasy',...))
```

After (from config):
```js
const genreList = GENRES.map(g => `'${g}'`).join(',');
db.exec(`... genre TEXT CHECK(genre IN (${genreList})) ...`);
```

Add `'instructional'` to `config.js` and the SQLite CHECK constraint automatically includes it. No manual SQL editing.

#### `src/routes/books.js` — Thin Adapter

Before: 146 lines of validation, SQL, date logic, error handling.
After: 31 lines that delegate everything to the service.

```js
const service = require('../services/book-service');

function send(res, result, successStatus = 200) {
  if (!result.ok) return res.status(400).json({ error: result.error, recovery: result.recovery });
  res.status(successStatus).json(result.data);
}

router.get('/', (req, res) => {
  send(res, service.listBooks(req.query));
});

router.post('/', (req, res) => {
  send(res, service.addBook(req.body), 201);
});

// ... same pattern for all routes
```

The routes file is now a transport adapter. It maps HTTP verbs to service calls and service results to HTTP status codes. That's it.

#### `src/mcp-server.js` — 9 Tools (Phase 1)

| Tool | Type | What it adds over Stage 2 |
|------|------|--------------------------|
| `list_books` | CRUD | Better descriptions (when/why, not just what) |
| `get_book` | CRUD | Recovery guidance on errors |
| `add_book` | CRUD | Contextual suggestions after creation |
| `update_book` | CRUD | State transition validation |
| `start_reading` | **Intent** | One call instead of LLM composing `update_book` |
| `finish_book` | **Intent** | Auto-date + rating + returns stats summary |
| `search_books` | **Intent** | Fuzzy search across title/author/notes |
| `get_reading_stats` | **Intelligence** | Dashboard the LLM can reference |
| `get_capabilities` | **Discovery** | LLM can ask "what can I do?" |

Every tool is now a thin wrapper over the service:

```js
// AI-Native: tool is just a service call
server.tool(
  "start_reading",
  "Mark a 'to-read' book as 'reading'. Simpler than update_book for this common action — just provide the book ID.",
  { id: z.number().int().positive().describe("Book ID to start reading") },
  async ({ id }) => reply(service.startReading(id))
);
```

Compare to AI-Using where each tool had 15-30 lines of inline SQL and logic.

### Phase 2 Changes (AI-Native)

All Phase 2 changes are in `src/mcp-server.js` only — no new files needed.

#### 3 MCP Resources (Passive Context)

Resources are data the LLM can read without calling a tool. The client can pre-load these into context.

**`bookshelf://schema`** — Self-describing data model:

```json
{
  "fields": {
    "id": { "type": "integer", "description": "Auto-generated unique ID" },
    "title": { "type": "string", "required": true, "description": "Book title" },
    "genre": { "type": "enum", "values": ["fiction", "sci-fi", ...], "description": "Book genre classification" },
    "status": { "type": "enum", "values": ["to-read", "reading", "read"], "default": "to-read" },
    ...
  },
  "transitions": {
    "to-read": ["reading"],
    "reading": ["read", "to-read"],
    "read": ["to-read"]
  },
  "transitionNotes": {
    "to-read → reading": "Use start_reading tool",
    "reading → read": "Use finish_book tool (auto-sets date_finished)",
    "reading → to-read": "Use update_book to move back to queue",
    "read → to-read": "Use update_book to re-read later"
  }
}
```

This means the LLM can understand the data model, valid values, and state transitions *before it ever calls a tool*. No trial-and-error.

**`bookshelf://stats`** — Live reading statistics (totals, averages, genre breakdown). The LLM can reference this when answering questions like "how am I doing?" without needing to call `get_reading_stats` first.

**`bookshelf://currently-reading`** — Books currently in progress. Quick context for "what am I reading?" without a tool call.

#### 2 MCP Prompts (Pre-Built Workflows)

Prompts are templates that assemble context and instructions into a message the LLM can execute.

**`monthly-review`** — Takes a `month` parameter (e.g. `2026-01`), gathers books finished that month, overall stats, and asks the LLM to generate a structured reading review:

```
Generate a monthly reading review for 2026-01.

Books finished this month (1):
[
  { "title": "Steve Jobs", "author": "Walter Isaacson", "rating": 4, ... }
]

Overall stats:
{ "total": 15, "read": 8, "avgRating": 4.3, ... }

Please provide:
1. A summary of what was read this month
2. Highlights and patterns (genres, ratings)
3. Comparison to overall reading habits
4. A suggestion for next month
```

**`recommend-next`** — Takes an optional `mood` parameter, gathers the to-read list, reading history, and stats, then asks the LLM to pick a next book and explain why.

#### State-Aware Responses

After mutations, the service returns contextual `_suggestion` fields:

```json
// After add_book with status "to-read":
{ "id": 16, "title": "New Book", ..., "_suggestion": "Added to your list. Use start_reading with id 16 when you begin." }

// After finish_book:
{ "id": 9, "title": "Neuromancer", ..., "_suggestion": "Finished \"Neuromancer\"! You've read 9 books. Average rating: 4.3. Currently reading 2." }
```

The LLM doesn't have to call `get_reading_stats` separately after finishing a book — the stats summary is right there in the response.

### Trade-Offs at This Stage

| Pros | Cons |
|------|------|
| Single source of truth for all enums | More files to navigate (config, service, MCP, routes) |
| State transitions are enforced | Service layer adds indirection |
| Intent tools reduce LLM round-trips | 275-line MCP server is longer than the 164-line bolt-on |
| Errors include recovery instructions | Resources/prompts add MCP-specific concepts to learn |
| Resources give passive context | Resources are read-only snapshots (can go stale in long sessions) |
| Prompts encode workflows | Prompts are opinionated — may not match every LLM's style |
| Service layer is reusable | Total code is larger (508 lines added vs 249 removed) |
| Search across title/author/notes | LIKE-based search isn't true fuzzy matching |
| Genre breakdown + avg ratings | Stats computed on every call (no caching) |

---

## Detailed File Walkthrough

### File Dependency Graph

```
src/config.js                 ← Single source of truth
    ↑           ↑
    │           │
src/db.js   src/services/book-service.js  ← Business logic
    ↑           ↑           ↑
    │           │           │
    │     src/routes/    src/mcp-server.js  ← Transport adapters
    │     books.js
    │        ↑
    │        │
    └── src/index.js  ← Express app
```

### `src/config.js` (18 lines)

**Role:** Define every enum, transition rule, and utility once.

Why it matters: before this file existed, adding a genre meant:
1. Edit the SQL CHECK constraint in `db.js`
2. Edit the `VALID_GENRES` array in `routes/books.js`
3. Edit the `VALID_GENRES` array in `mcp-server.js`
4. Hope you spelled it the same in all three places

Now: edit one array in `config.js`. The SQL constraint, service validation, MCP tool schemas, and REST validation all derive from it.

### `src/db.js` (29 lines)

**Role:** SQLite connection + schema creation.

The schema uses template literals to build CHECK constraints from config:

```js
const genreList = GENRES.map(g => `'${g}'`).join(',');
// becomes: 'fiction','sci-fi','fantasy',...,'instructional'
```

**Trade-off:** This means the CHECK constraint is built at runtime from JavaScript. If someone edits the DB schema manually, it could drift from the config. In practice, since `CREATE TABLE IF NOT EXISTS` only runs on first creation, the constraint is set at DB creation time. To update it after adding a genre, you'd need to delete and re-create the DB (`rm books.db && npm run seed`).

### `src/services/book-service.js` (241 lines)

**Role:** All business logic. Both REST and MCP are thin adapters over this.

The structured `{ ok, error, recovery, suggestion }` pattern means callers never need to catch exceptions or parse error strings — they check `result.ok` and branch.

**`searchBooks(query)`** — Uses SQL LIKE which is case-insensitive on ASCII in SQLite. It's not true fuzzy search (no typo tolerance, no relevance ranking), but it covers the common case of "that genetics book" matching notes that say "exploration of genetics."

**`finishBook(id, { rating, notes })`** — This is the showcase intent operation. In Stage 2, finishing a book required the LLM to:
1. Call `get_book` to check current status
2. Decide if it can transition to `read`
3. Call `update_book` with status, rating, notes, and hope date_finished is auto-set

Now: one call. The service validates the transition, sets the date, and returns a stats summary. Three round-trips become one.

**`getReadingStats()`** — Computes everything in-memory by loading all books. This is fine for a personal collection (hundreds of books) but would not scale to a library database (millions). No caching — stats are always fresh but always re-computed.

### `src/routes/books.js` (31 lines)

**Role:** Map HTTP verbs to service calls. Map service results to HTTP status codes.

The only "logic" left is deciding which HTTP status code to return:
- Service `ok: true` -> 200 (or 201 for POST)
- Service `ok: false` with "not found" -> 404
- Service `ok: false` otherwise -> 400

### `src/mcp-server.js` (275 lines)

**Role:** MCP protocol adapter with tools, resources, and prompts.

The `reply()` helper translates service results into MCP's `{ content, isError }` format:

```js
function reply(result) {
  const payload = result.ok
    ? { ...result.data, ...(result.suggestion ? { _suggestion: result.suggestion } : {}) }
    : { error: result.error, recovery: result.recovery };

  const text = Array.isArray(result.data)
    ? JSON.stringify(result.ok ? result.data : payload, null, 2)
    : JSON.stringify(payload, null, 2);

  return { content: [{ type: "text", text }], isError: !result.ok };
}
```

**Why `_suggestion` is prefixed with underscore:** It's metadata for the LLM, not part of the book data model. The underscore convention signals "this is advisory, not a data field." The LLM can use it to guide its next response without confusing it with book attributes.

---

## What the LLM Sees at Each Stage

### Scenario: User says "I just finished Neuromancer, it was amazing — 5 stars"

#### Stage 2 (AI-Using)

The LLM must:

```
Step 1: Realize "Neuromancer" needs to be looked up by name (no search tool)
Step 2: Call list_books with no filters (or guess author="Gibson")
Step 3: Find Neuromancer's ID from the list
Step 4: Call update_book with { id: 9, status: "read", rating: 5 }
Step 5: Hope that date_finished is auto-set (can't see this from tool descriptions)
Step 6: Maybe call get_book to confirm the update worked
Step 7: Craft a response with no stats context
```

If it tries `status: "read"` on a `to-read` book, the tool accepts it (no transition validation) — creating invalid data.

Error if book not found: `{ "error": "Book not found" }` — no guidance.

#### Stage 3 (AI-Native)

The LLM:

```
Step 1: Call search_books with query "Neuromancer"
Step 2: Call finish_book with { id: 9, rating: 5, notes: "Amazing" }
Step 3: Response includes: { ..., _suggestion: "Finished \"Neuromancer\"! You've read 9 books. Average rating: 4.3." }
```

Two calls instead of four-to-six. The response includes stats context so the LLM can say "That's your 9th book! Your average rating is 4.3."

If the book was `to-read` instead of `reading`:
```json
{ "error": "\"Neuromancer\" hasn't been started yet", "recovery": "Use start_reading first" }
```
The LLM knows exactly what to do.

### Scenario: User asks "What should I read next? I'm in the mood for something mind-bending"

#### Stage 2 (AI-Using)

The LLM must:
1. Call `list_books` with `status: "to-read"` to see the queue
2. Call `list_books` with `status: "read"` to see past preferences
3. Manually analyze genres, ratings, and match to "mind-bending"
4. Synthesize a recommendation from two separate data dumps

#### Stage 3 (AI-Native)

The client invokes the `recommend-next` prompt with `mood: "something mind-bending"`. The prompt pre-assembles:
- The full to-read list
- The full reading history
- Stats with genre breakdown
- Structured instructions for the LLM

The LLM gets everything in one context injection. Zero tool calls needed.

---

## Trade-Off Analysis

### Complexity vs. Capability

```
                    Capability
                    ▲
                    │              ★ Stage 3
                    │            ╱
                    │          ╱   (9 tools, 3 resources, 2 prompts,
                    │        ╱      state machine, error recovery)
                    │      ╱
                    │    ╱
                    │  ★ Stage 2
                    │  │  (4 tools, basic CRUD)
                    │  │
                    │  │
                    ★──┼──────────────────────► Complexity
                Stage 1
                (REST only)
```

Stage 2 adds capability cheaply (bolt on MCP) but hits a ceiling fast. Stage 3 adds more complexity but the capability curve steepens — intent tools, resources, and prompts compound each other.

### Where Intelligence Lives

| Aspect | Stage 1 | Stage 2 | Stage 3 |
|--------|---------|---------|---------|
| Validation | Route handler | Route + MCP (duplicated) | Service (shared) |
| State transitions | None enforced | None enforced | Service enforces via TRANSITIONS map |
| Error recovery | HTTP status codes | `isError: true` | `{ error, recovery }` with actionable hints |
| "Finish a book" | PUT with status=read | `update_book` (LLM composes) | `finish_book` (one intent call) |
| Search | N/A | N/A | `search_books` across 3 fields |
| Stats | N/A | N/A | `get_reading_stats` with genre breakdown |
| Data model awareness | None | Tool descriptions | `bookshelf://schema` resource |
| Workflow templates | None | None | `monthly-review`, `recommend-next` prompts |

### The "Envelope of Autonomy"

Each stage expands what the LLM can do without human intervention:

- **Stage 1:** LLM can't interact at all (REST only, needs HTTP client)
- **Stage 2:** LLM can CRUD books but must compose workflows manually and handle errors by guessing
- **Stage 3:** LLM can execute intent operations, self-recover from errors, access passive context, and run pre-built workflows

### When You Don't Need Stage 3

Stage 2 (AI-Using) is sufficient when:
- Your app is simple CRUD with no domain-specific workflows
- The LLM only needs to read data, not orchestrate multi-step operations
- Error recovery isn't critical (human is always in the loop)
- You want to add MCP quickly without restructuring

Stage 3 (AI-Native) is worth it when:
- The LLM needs to perform multi-step domain operations (start reading -> finish -> get stats)
- Error messages need to guide the LLM's next action
- You want the LLM to understand your data model without trial and error
- You have recurring workflows worth encoding as prompts
- Multiple interfaces (REST + MCP) need consistent behavior

### What Stage 3 Doesn't Solve

- **No authentication/authorization** — any connected LLM can modify all data
- **No undo/history** — mutations are permanent (no event sourcing)
- **No real fuzzy search** — LIKE-based, no typo tolerance or relevance scoring
- **No caching** — stats recomputed on every call
- **SQLite constraint drift** — if you add a genre to config without re-creating the DB, the SQLite CHECK constraint won't include it (only applied at CREATE TABLE time)
- **Resources can go stale** — if the client caches `bookshelf://stats`, it won't reflect books added mid-session
- **Prompts are opinionated** — the `monthly-review` format may not match what every LLM or user wants

---

## Architecture Comparison

### Code Ownership per Concern

| Concern | Stage 1 | Stage 2 | Stage 3 |
|---------|---------|---------|---------|
| Enum definitions | db.js, routes/books.js | db.js, routes/books.js, mcp-server.js | **config.js only** |
| Validation | routes/books.js | routes/books.js + mcp-server.js | **book-service.js only** |
| SQL queries | routes/books.js | routes/books.js + mcp-server.js | **book-service.js only** |
| Date logic | routes/books.js | routes/books.js + mcp-server.js | **book-service.js only** |
| HTTP mapping | routes/books.js | routes/books.js | routes/books.js |
| MCP mapping | N/A | mcp-server.js | mcp-server.js |

Stage 3's service layer means every concern has exactly one owner. The "where do I fix X?" question always has one answer.

### Duplication Eliminated

```
Stage 1:  2 copies of enums  (db.js, routes)
Stage 2:  3 copies of enums  (db.js, routes, mcp-server)
          2 copies of CRUD logic  (routes, mcp-server)
          2 copies of validation  (routes, mcp-server)
Stage 3:  1 copy of everything  (config for enums, service for logic)
```

---

## The Skill Layer

Stage 3 gives the LLM **capabilities** (9 tools, 3 resources, 2 prompts). The skill layer gives it **domain expertise** — knowing which tool to reach for before it even starts.

```
.claude/skills/bookshelf/SKILL.md
```

Invoke it with `/bookshelf` in Claude Code.

### What the Skill Encodes

| Knowledge | Without skill | With skill |
|-----------|--------------|------------|
| "I finished X" → which tool? | LLM rediscovers `finish_book` each session | Instant: `search_books` → `finish_book` |
| Valid status transitions | LLM calls `get_capabilities` or reads `bookshelf://schema` | Inline — no tool call needed |
| Valid genres/statuses | LLM calls `get_capabilities` to look them up | Inline reference |
| Error recovery | LLM reads error, reasons about next step | Follow the `recovery` field literally |
| "What should I read?" | LLM composes `list_books` + manual analysis | Use `recommend-next` prompt directly |

### The Standard Layering

```
┌─────────────────────────┐
│  Skill (SKILL.md)       │  ← Domain expertise: intent→tool mapping,
│  "I finished X" →       │    state machine, workflow recipes
│  search_books →         │
│  finish_book            │
├─────────────────────────┤
│  MCP Client             │  ← Connection: Claude Code connects to server
├─────────────────────────┤
│  MCP Server             │  ← Capabilities: 9 tools, 3 resources, 2 prompts
│  (src/mcp-server.js)    │
├─────────────────────────┤
│  Service Layer          │  ← Business logic: validation, state machine
│  (src/services/         │
│   book-service.js)      │
└─────────────────────────┘
```

Without the skill, Claude sees 9 disconnected tools and has to rediscover the workflow patterns every conversation. With it, that knowledge is baked in once.

### Skill Contents

- **Intent-to-tool mapping** — 12 common phrases mapped to exact tool sequences
- **State machine** — all valid transitions with which tool to use, embedded inline
- **Workflow recipes** — multi-step patterns like "finish book" (2 calls max) and "monthly review" (use the prompt)
- **Error recovery protocol** — always follow the `recovery` field from error responses
- **Enum reference** — 3 statuses, 11 genres listed directly so no discovery call is needed
- **Parameter quick reference** — required vs optional params for all 9 tools

---

## The Progression in Numbers

| Metric | Stage 1 | Stage 2 | Stage 3 |
|--------|---------|---------|---------|
| Source files | 4 | 5 | 7 |
| Total source lines | 395 | 559 | 627 |
| MCP tools | 0 | 4 | 9 |
| MCP resources | 0 | 0 | 3 |
| MCP prompts | 0 | 0 | 2 |
| Enum locations | 2 | 3 | 1 |
| State transition enforcement | No | No | Yes |
| Error recovery guidance | No | No | Yes |
| Intent operations | 0 | 0 | 3 |
| `routes/books.js` | 146 lines | 146 lines | 31 lines |
| `mcp-server.js` | N/A | 164 lines | 275 lines |
| Business logic owner | routes | routes + mcp (split) | service (single) |

### Git History

```
6796772  init with restful api              (Stage 1: REST only)
b082a6e  ai use                             (Stage 2: MCP bolt-on, +813 lines)
090f890  Bridge book-api AI-Using to Native (Stage 3: +508 / -249 lines)
```

---

## Summary

The progression from REST to AI-Native isn't about adding more code — it's about moving intelligence to the right place:

- **Stage 1** puts all logic in HTTP handlers. Fine for traditional web apps.
- **Stage 2** copies that logic into MCP tools. Quick to ship, but the LLM carries all the burden.
- **Stage 3** extracts logic into a service layer and gives the LLM resources (passive context), intent tools (domain operations), and prompts (pre-built workflows). The service is smart so the LLM doesn't have to be.

The skill layer (`.claude/skills/bookshelf/SKILL.md`) completes the picture by encoding *domain expertise* on top of the server's capabilities — so the LLM doesn't rediscover workflow patterns every session.

The core insight: **the less the LLM has to guess, the better it performs.** Structured errors, intent operations, self-describing schemas, and skills all reduce guesswork. The trade-off is more code and more abstraction — but each piece has a clear purpose and a single owner.
