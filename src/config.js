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

module.exports = { GENRES, STATUSES, TRANSITIONS, today };
