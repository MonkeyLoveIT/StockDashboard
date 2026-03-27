import express from 'express';
import { getQuote } from '../proxy.js';

const router = express.Router();

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
