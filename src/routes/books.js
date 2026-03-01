const express = require('express');
const router = express.Router();
const db = require('../db');

const VALID_STATUSES = ['to-read', 'reading', 'read'];
const VALID_GENRES = ['fiction', 'sci-fi', 'fantasy', 'history', 'biography', 'science', 'philosophy', 'non-fiction', 'mystery', 'self-help'];

function validateBook(body, isUpdate = false) {
  const errors = [];

  if (!isUpdate) {
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      errors.push('title is required');
    }
    if (!body.author || typeof body.author !== 'string' || !body.author.trim()) {
      errors.push('author is required');
    }
  }

  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (body.genre !== undefined && body.genre !== null && !VALID_GENRES.includes(body.genre)) {
    errors.push(`genre must be one of: ${VALID_GENRES.join(', ')}`);
  }

  if (body.rating !== undefined && body.rating !== null) {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      errors.push('rating must be an integer between 1 and 5');
    }
  }

  if (body.pages !== undefined && body.pages !== null) {
    const pages = Number(body.pages);
    if (!Number.isInteger(pages) || pages <= 0) {
      errors.push('pages must be a positive integer');
    }
  }

  return errors;
}

// GET /api/books — List all books with optional filters
router.get('/', (req, res) => {
  const { status, genre, author } = req.query;
  let sql = 'SELECT * FROM books';
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (genre) {
    conditions.push('genre = ?');
    params.push(genre);
  }
  if (author) {
    conditions.push('author LIKE ?');
    params.push(`%${author}%`);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY date_added DESC';

  const books = db.prepare(sql).all(...params);
  res.json(books);
});

// GET /api/books/:id — Get a single book
router.get('/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) {
    return res.status(404).json({ error: 'Book not found' });
  }
  res.json(book);
});

// POST /api/books — Add a new book
router.post('/', (req, res) => {
  const errors = validateBook(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const {
    title, author, genre = null, rating = null,
    status = 'to-read', pages = null, notes = null
  } = req.body;

  const date_added = new Date().toISOString().split('T')[0];
  const date_finished = status === 'read' ? date_added : null;

  const stmt = db.prepare(`
    INSERT INTO books (title, author, genre, rating, status, pages, date_added, date_finished, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(title.trim(), author.trim(), genre, rating, status, pages, date_added, date_finished, notes);

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(book);
});

// PUT /api/books/:id — Update a book (merge-style partial update)
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Book not found' });
  }

  const errors = validateBook(req.body, true);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const updated = { ...existing, ...req.body };

  // Auto-set date_finished when status transitions to "read"
  if (req.body.status === 'read' && existing.status !== 'read') {
    updated.date_finished = new Date().toISOString().split('T')[0];
  }

  const stmt = db.prepare(`
    UPDATE books
    SET title = ?, author = ?, genre = ?, rating = ?, status = ?,
        pages = ?, date_finished = ?, notes = ?
    WHERE id = ?
  `);

  stmt.run(
    updated.title, updated.author, updated.genre, updated.rating,
    updated.status, updated.pages, updated.date_finished, updated.notes,
    req.params.id
  );

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  res.json(book);
});

module.exports = router;
