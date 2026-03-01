---
name: bookshelf
description: |
  Manage your bookshelf — add books, track reading progress, get recommendations,
  and review stats. Knows the exact MCP tools to call for any book-related request.
  Trigger: user mentions books, reading, bookshelf, "what should I read", "how am I doing",
  "I finished", "started reading", "add [book]", "monthly review"
user_invocable: true
---

# Bookshelf Skill

You have access to the `book-api` MCP server with 9 tools, 3 resources, and 2 prompts.
This skill tells you exactly which tool to use and how — so you never waste round-trips.

## Intent-to-Tool Mapping

| User says | Tool to use | NOT this |
|-----------|------------|----------|
| "I finished X" / "done with X" | `search_books` → `finish_book` | `update_book` |
| "Started reading X" / "reading X now" | `search_books` → `start_reading` | `update_book` |
| "Add X by Y" | `add_book` | — |
| "Add X and start it" | `add_book` → `start_reading` | — |
| "That genetics book" / vague reference | `search_books` | `list_books` |
| "What should I read?" / "recommend" | `recommend-next` prompt | manual composition |
| "How am I doing?" / "stats" / "progress" | `get_reading_stats` | `list_books` + manual counting |
| "Monthly review" / "how was January" | `monthly-review` prompt | manual filtering |
| "What am I reading?" | `list_books` with `status: "reading"` | `get_reading_stats` |
| "Show my to-read list" | `list_books` with `status: "to-read"` | unfiltered `list_books` |
| "Show all sci-fi" | `list_books` with `genre: "sci-fi"` | `search_books` |
| "Put X back on my list" / "re-read later" | `update_book` with `status: "to-read"` | — |

**Key rule:** When the user refers to a book by name/description (not ID), always `search_books` first to resolve the ID, then call the action tool.

## Status State Machine

Three statuses, four valid transitions:

```
to-read  ──start_reading──▶  reading
reading  ──finish_book────▶  read        (auto-sets date_finished to today)
reading  ──update_book────▶  to-read     (abandon / back to queue)
read     ──update_book────▶  to-read     (re-read later)
```

**Invalid transitions** (the server will reject these):
- `to-read` → `read` (must start reading first)
- `read` → `reading` (must go back to `to-read` first)

You know these rules — never call `get_capabilities` or read `bookshelf://schema` just to check transitions.

## Workflow Recipes

### "I finished [book]" (with optional rating/notes)
1. `search_books` with the book name → get `id`
2. `finish_book` with `id` (+ `rating`, `notes` if provided)

That's it. 2 calls max. Do NOT use `update_book` for this.

### "Add [book] and start reading it"
1. `add_book` with title, author, genre (if known) → get `id` from response
2. `start_reading` with `id`

### "I started reading [book]"
1. `search_books` → get `id`
2. `start_reading` with `id`

### "Monthly review" / "How was [month]?"
1. Use the `monthly-review` prompt with `month` in `YYYY-MM` format (e.g. `2026-01`)
2. The prompt injects all data — just follow its instructions

### "What should I read next?"
1. Use the `recommend-next` prompt (pass `mood` if the user mentioned one)
2. The prompt injects the to-read list and reading history — just follow its instructions

### "How am I doing?" / Reading stats
1. `get_reading_stats` — returns totals, averages, genre breakdown, currently reading
2. Present it conversationally. No need to call `list_books` separately.

## Valid Enums

### Statuses
`to-read`, `reading`, `read`

### Genres
`fiction`, `sci-fi`, `fantasy`, `history`, `biography`, `science`, `philosophy`, `non-fiction`, `mystery`, `self-help`, `instructional`

You know these — never call `get_capabilities` just to look them up.

## Error Recovery

When a tool returns `isError: true`, the response always has this shape:
```json
{ "error": "description", "recovery": "actionable instruction" }
```

**Always follow the `recovery` field literally.** Do not guess an alternative. Examples:
- `"recovery": "Use start_reading first"` → call `start_reading`, then retry
- `"recovery": "Use list_books to see available books and their IDs"` → do that
- `"recovery": "Valid statuses: to-read, reading, read"` → fix the status value

## Tool Parameters Quick Reference

| Tool | Required params | Optional params |
|------|----------------|-----------------|
| `list_books` | — | `status`, `genre`, `author` |
| `get_book` | `id` | — |
| `add_book` | `title`, `author` | `genre`, `rating`, `status`, `pages`, `notes` |
| `update_book` | `id` | `title`, `author`, `genre`, `rating`, `status`, `pages`, `notes` |
| `start_reading` | `id` | — |
| `finish_book` | `id` | `rating`, `notes` |
| `search_books` | `query` | — |
| `get_reading_stats` | — | — |
| `get_capabilities` | — | — |

## Suggestions

Successful mutations return a `_suggestion` field with a natural next action hint. Mention it conversationally to the user when relevant (e.g. "Want me to start reading it?" after adding a book).
