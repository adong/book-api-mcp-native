const express = require('express');
const router = express.Router();
const service = require('../services/book-service');

function send(res, result, successStatus = 200) {
  if (!result.ok) return res.status(400).json({ error: result.error, recovery: result.recovery });
  res.status(successStatus).json(result.data);
}

router.get('/', (req, res) => {
  send(res, service.listBooks(req.query));
});

router.get('/:id', (req, res) => {
  const result = service.getBook(Number(req.params.id));
  if (!result.ok) return res.status(404).json({ error: result.error, recovery: result.recovery });
  res.json(result.data);
});

router.post('/', (req, res) => {
  send(res, service.addBook(req.body), 201);
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const result = service.updateBook(Number(id), req.body);
  if (!result.ok && result.error.includes('not found')) return res.status(404).json({ error: result.error, recovery: result.recovery });
  send(res, result);
});

module.exports = router;
