const Database = require('better-sqlite3');
const path = require('path');
const { GENRES, STATUSES } = require('./config');

const dbPath = path.join(__dirname, '..', 'books.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const genreList = GENRES.map(g => `'${g}'`).join(',');
const statusList = STATUSES.map(s => `'${s}'`).join(',');

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    genre TEXT CHECK(genre IN (${genreList})),
    rating INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5)),
    status TEXT NOT NULL DEFAULT 'to-read' CHECK(status IN (${statusList})),
    pages INTEGER CHECK(pages IS NULL OR pages > 0),
    date_added TEXT NOT NULL,
    date_finished TEXT,
    notes TEXT
  )
`);

module.exports = db;
