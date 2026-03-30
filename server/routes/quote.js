import express from 'express';
import { getQuote } from '../proxy.js';

const router = express.Router();

// GET /api/quote/batch?codes=600000,600016
router.get('/batch', async (req, res) => {
  try {
    const codes = req.query.codes;
    if (!codes) return res.status(400).json({ error: 'codes required' });

    const codeList = codes.split(',').map(c => c.trim()).filter(Boolean);
    if (codeList.length === 0) return res.json({ results: [] });
    if (codeList.length > 50) return res.status(400).json({ error: 'Max 50 codes per batch' });

    const quotes = await Promise.all(codeList.map(c => getQuote(c).catch(() => null)));
    const results = quotes.filter(q => q && !q.error);
    res.json({ results });
  } catch (error) {
    console.error('Batch quote error:', error);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// GET /api/quote/:code
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const quote = await getQuote(code);

    if (quote.error) {
      return res.status(404).json(quote);
    }

    res.json(quote);
  } catch (error) {
    console.error('Error fetching quote:', error);
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

export default router;
