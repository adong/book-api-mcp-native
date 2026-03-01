const db = require('./db');

const books = [
  // 8 books with status "read"
  {
    title: 'Dune',
    author: 'Frank Herbert',
    genre: 'sci-fi',
    rating: 5,
    status: 'read',
    pages: 412,
    date_added: '2025-08-10',
    date_finished: '2025-09-02',
    notes: 'A masterpiece of world-building and political intrigue'
  },
  {
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    genre: 'sci-fi',
    rating: 5,
    status: 'read',
    pages: 476,
    date_added: '2025-09-05',
    date_finished: '2025-09-20',
    notes: 'Couldn\'t put it down. Rocky is the best.'
  },
  {
    title: 'Sapiens',
    author: 'Yuval Noah Harari',
    genre: 'history',
    rating: 4,
    status: 'read',
    pages: 443,
    date_added: '2025-09-15',
    date_finished: '2025-10-10',
    notes: 'Thought-provoking overview of human history'
  },
  {
    title: 'The Name of the Wind',
    author: 'Patrick Rothfuss',
    genre: 'fantasy',
    rating: 5,
    status: 'read',
    pages: 662,
    date_added: '2025-10-01',
    date_finished: '2025-10-28',
    notes: 'Beautiful prose, compelling narrator'
  },
  {
    title: 'Meditations',
    author: 'Marcus Aurelius',
    genre: 'philosophy',
    rating: 4,
    status: 'read',
    pages: 256,
    date_added: '2025-10-20',
    date_finished: '2025-11-05',
    notes: 'Timeless Stoic wisdom'
  },
  {
    title: 'The Gene',
    author: 'Siddhartha Mukherjee',
    genre: 'science',
    rating: 4,
    status: 'read',
    pages: 594,
    date_added: '2025-11-01',
    date_finished: '2025-12-01',
    notes: 'Dense but rewarding exploration of genetics'
  },
  {
    title: 'Gone Girl',
    author: 'Gillian Flynn',
    genre: 'mystery',
    rating: 3,
    status: 'read',
    pages: 432,
    date_added: '2025-12-05',
    date_finished: '2025-12-20',
    notes: 'Twisty plot, unsettling characters'
  },
  {
    title: 'Steve Jobs',
    author: 'Walter Isaacson',
    genre: 'biography',
    rating: 4,
    status: 'read',
    pages: 656,
    date_added: '2025-12-22',
    date_finished: '2026-01-15',
    notes: 'Fascinating portrait of a complex person'
  },
  // 3 books with status "reading"
  {
    title: 'Neuromancer',
    author: 'William Gibson',
    genre: 'sci-fi',
    rating: null,
    status: 'reading',
    pages: 271,
    date_added: '2026-01-20',
    date_finished: null,
    notes: 'Cyberpunk classic, about halfway through'
  },
  {
    title: 'Thinking, Fast and Slow',
    author: 'Daniel Kahneman',
    genre: 'science',
    rating: null,
    status: 'reading',
    pages: 499,
    date_added: '2026-01-25',
    date_finished: null,
    notes: null
  },
  {
    title: 'The Wise Man\'s Fear',
    author: 'Patrick Rothfuss',
    genre: 'fantasy',
    rating: null,
    status: 'reading',
    pages: 994,
    date_added: '2026-02-01',
    date_finished: null,
    notes: 'Sequel to Name of the Wind'
  },
  // 4 books with status "to-read"
  {
    title: 'Homo Deus',
    author: 'Yuval Noah Harari',
    genre: 'history',
    rating: null,
    status: 'to-read',
    pages: 448,
    date_added: '2026-02-05',
    date_finished: null,
    notes: 'Follow-up to Sapiens'
  },
  {
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    genre: 'sci-fi',
    rating: null,
    status: 'to-read',
    pages: 304,
    date_added: '2026-02-10',
    date_finished: null,
    notes: null
  },
  {
    title: 'Atomic Habits',
    author: 'James Clear',
    genre: 'self-help',
    rating: null,
    status: 'to-read',
    pages: 320,
    date_added: '2026-02-15',
    date_finished: null,
    notes: 'Recommended by a friend'
  },
  {
    title: 'The Midnight Library',
    author: 'Matt Haig',
    genre: 'fiction',
    rating: null,
    status: 'to-read',
    pages: 288,
    date_added: '2026-02-20',
    date_finished: null,
    notes: null
  }
];

// Clear existing data and insert seed books
db.exec('DELETE FROM books');

const insert = db.prepare(`
  INSERT INTO books (title, author, genre, rating, status, pages, date_added, date_finished, notes)
  VALUES (@title, @author, @genre, @rating, @status, @pages, @date_added, @date_finished, @notes)
`);

const insertMany = db.transaction((books) => {
  for (const book of books) {
    insert.run(book);
  }
});

insertMany(books);

console.log(`Seeded ${books.length} books into the database.`);
