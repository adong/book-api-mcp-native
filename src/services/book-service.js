const db = require('../db');
const { GENRES, STATUSES, TRANSITIONS, today } = require('../config');

function ok(data, extras = {}) {
  return { ok: true, data, ...extras };
}

function fail(error, recovery) {
  return { ok: false, error, recovery };
}

// --- Query operations ---

function listBooks({ status, genre, author } = {}) {
  let sql = 'SELECT * FROM books';
  const conditions = [];
  const params = [];

  if (status) {
    if (!STATUSES.includes(status)) return fail(`Invalid status "${status}"`, `Valid statuses: ${STATUSES.join(', ')}`);
    conditions.push('status = ?');
    params.push(status);
  }
  if (genre) {
    if (!GENRES.includes(genre)) return fail(`Invalid genre "${genre}"`, `Valid genres: ${GENRES.join(', ')}`);
    conditions.push('genre = ?');
    params.push(genre);
  }
  if (author) {
    conditions.push('author LIKE ?');
    params.push(`%${author}%`);
  }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY date_added DESC';

  return ok(db.prepare(sql).all(...params));
}

function getBook(id) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!book) return fail(`Book #${id} not found`, 'Use list_books to see available books and their IDs');
  return ok(book);
}

function searchBooks(query) {
  if (!query || !query.trim()) return fail('Search query is required', 'Provide a term to search across title, author, and notes');
  const term = `%${query.trim()}%`;
  const books = db.prepare(
    'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? OR notes LIKE ? ORDER BY date_added DESC'
  ).all(term, term, term);
  return ok(books, { suggestion: books.length === 0 ? 'No matches. Try a broader search term or use list_books to browse.' : undefined });
}

// --- Mutations ---

function addBook({ title, author, genre, rating, status = 'to-read', pages, notes }) {
  const errors = [];
  if (!title || !title.trim()) errors.push('title is required');
  if (!author || !author.trim()) errors.push('author is required');
  if (genre != null && !GENRES.includes(genre)) errors.push(`genre must be one of: ${GENRES.join(', ')}`);
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) errors.push('rating must be 1-5');
  if (status && !STATUSES.includes(status)) errors.push(`status must be one of: ${STATUSES.join(', ')}`);
  if (pages != null && (!Number.isInteger(pages) || pages <= 0)) errors.push('pages must be a positive integer');
  if (errors.length > 0) return fail(errors.join('; '), 'Fix the listed fields and try again');

  const date_added = today();
  const date_finished = status === 'read' ? date_added : null;

  const result = db.prepare(`
    INSERT INTO books (title, author, genre, rating, status, pages, date_added, date_finished, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title.trim(), author.trim(), genre ?? null, rating ?? null, status, pages ?? null, date_added, date_finished, notes ?? null);

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);

  let suggestion;
  if (status === 'to-read') suggestion = `Added to your list. Use start_reading with id ${book.id} when you begin.`;
  else if (status === 'reading') suggestion = `Now reading! Use finish_book with id ${book.id} when done.`;

  return ok(book, { suggestion });
}

function updateBook(id, fields) {
  const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!existing) return fail(`Book #${id} not found`, 'Use list_books to see available books and their IDs');

  const { title, author, genre, rating, status, pages, notes } = fields;
  const errors = [];
  if (title !== undefined && (!title || !title.trim())) errors.push('title cannot be empty');
  if (author !== undefined && (!author || !author.trim())) errors.push('author cannot be empty');
  if (genre !== undefined && genre != null && !GENRES.includes(genre)) errors.push(`genre must be one of: ${GENRES.join(', ')}`);
  if (rating !== undefined && rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) errors.push('rating must be 1-5');
  if (pages !== undefined && pages != null && (!Number.isInteger(pages) || pages <= 0)) errors.push('pages must be a positive integer');

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      errors.push(`status must be one of: ${STATUSES.join(', ')}`);
    } else {
      const allowed = TRANSITIONS[existing.status];
      if (!allowed.includes(status)) {
        errors.push(`Cannot transition from "${existing.status}" to "${status}". Allowed: ${allowed.join(', ')}`);
      }
    }
  }

  if (errors.length > 0) return fail(errors.join('; '), 'Fix the listed fields and try again');

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

  if (status === 'read' && existing.status !== 'read') {
    updated.date_finished = today();
  }

  db.prepare(`
    UPDATE books
    SET title = ?, author = ?, genre = ?, rating = ?, status = ?,
        pages = ?, date_finished = ?, notes = ?
    WHERE id = ?
  `).run(updated.title, updated.author, updated.genre, updated.rating,
    updated.status, updated.pages, updated.date_finished, updated.notes, id);

  return ok(db.prepare('SELECT * FROM books WHERE id = ?').get(id));
}

// --- Intent operations ---

function startReading(id) {
  const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!existing) return fail(`Book #${id} not found`, 'Use list_books to see available books and their IDs');

  if (existing.status === 'reading') return fail(`"${existing.title}" is already being read`, 'Use finish_book when you complete it');
  if (existing.status === 'read') return fail(`"${existing.title}" is already finished`, 'Change status to "to-read" first via update_book, then start reading');

  db.prepare('UPDATE books SET status = ? WHERE id = ?').run('reading', id);
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  return ok(book, { suggestion: `Now reading "${book.title}". Use finish_book with id ${id} when done.` });
}

function finishBook(id, { rating, notes } = {}) {
  const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!existing) return fail(`Book #${id} not found`, 'Use list_books to see available books and their IDs');

  if (existing.status === 'read') return fail(`"${existing.title}" is already finished`, 'Use update_book to change its rating or notes');
  if (existing.status === 'to-read') return fail(`"${existing.title}" hasn't been started yet`, 'Use start_reading first');

  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return fail('rating must be 1-5', 'Provide an integer between 1 and 5');
  }

  const date_finished = today();
  const newRating = rating ?? existing.rating;
  const newNotes = notes !== undefined ? notes : existing.notes;

  db.prepare('UPDATE books SET status = ?, rating = ?, date_finished = ?, notes = ? WHERE id = ?')
    .run('read', newRating, date_finished, newNotes, id);

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  const stats = getReadingStats();
  return ok(book, { suggestion: `Finished "${book.title}"! ${_statsSummary(stats.data)}` });
}

// --- Intelligence ---

function getReadingStats() {
  const all = db.prepare('SELECT * FROM books').all();
  const read = all.filter(b => b.status === 'read');
  const reading = all.filter(b => b.status === 'reading');
  const toRead = all.filter(b => b.status === 'to-read');

  const ratings = read.filter(b => b.rating != null).map(b => b.rating);
  const avgRating = ratings.length > 0 ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;

  const genreBreakdown = {};
  for (const book of read) {
    if (book.genre) {
      if (!genreBreakdown[book.genre]) genreBreakdown[book.genre] = { count: 0, ratings: [] };
      genreBreakdown[book.genre].count++;
      if (book.rating != null) genreBreakdown[book.genre].ratings.push(book.rating);
    }
  }
  for (const genre of Object.keys(genreBreakdown)) {
    const r = genreBreakdown[genre].ratings;
    genreBreakdown[genre].avgRating = r.length > 0 ? +(r.reduce((a, b) => a + b, 0) / r.length).toFixed(1) : null;
    delete genreBreakdown[genre].ratings;
  }

  return ok({
    total: all.length,
    read: read.length,
    reading: reading.length,
    toRead: toRead.length,
    avgRating,
    genreBreakdown,
    currentlyReading: reading.map(b => ({ id: b.id, title: b.title, author: b.author })),
  });
}

function _statsSummary(stats) {
  const parts = [`You've read ${stats.read} book${stats.read !== 1 ? 's' : ''}.`];
  if (stats.avgRating) parts.push(`Average rating: ${stats.avgRating}.`);
  if (stats.reading > 0) parts.push(`Currently reading ${stats.reading}.`);
  return parts.join(' ');
}

// --- Discovery ---

function getCapabilities() {
  return ok({
    tools: [
      { name: 'list_books', type: 'query', description: 'List/filter books by status, genre, or author' },
      { name: 'get_book', type: 'query', description: 'Get a single book by ID' },
      { name: 'search_books', type: 'query', description: 'Fuzzy search across title, author, and notes' },
      { name: 'add_book', type: 'mutation', description: 'Add a new book to the collection' },
      { name: 'update_book', type: 'mutation', description: 'Partial update with state transition validation' },
      { name: 'start_reading', type: 'intent', description: 'Mark a to-read book as reading' },
      { name: 'finish_book', type: 'intent', description: 'Mark a reading book as read with optional rating/notes' },
      { name: 'get_reading_stats', type: 'intelligence', description: 'Dashboard with totals, averages, genre breakdown' },
      { name: 'get_capabilities', type: 'discovery', description: 'This tool — lists what you can do' },
    ],
    statuses: STATUSES,
    genres: GENRES,
    transitions: TRANSITIONS,
  });
}

module.exports = {
  listBooks, getBook, searchBooks,
  addBook, updateBook,
  startReading, finishBook,
  getReadingStats, getCapabilities,
};
