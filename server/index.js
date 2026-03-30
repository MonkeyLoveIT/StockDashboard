import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import positionRoutes from './routes/positions.js';
import quoteRoutes from './routes/quote.js';
import klineRoutes from './routes/kline.js';
import searchRoutes from './routes/search.js';
import screenerRoutes from './routes/screener.js';
import marketRoutes from './routes/market.js';
import notifyRoutes from './routes/notify.js';
import cronConfigRoutes from './routes/cronConfig.js';
import { startCron, loadConfig } from './cron.js';
import paperRoutes from './routes/paper.js';
import { registerPaperEngine } from './paperEngine.js';

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initDb();

// Routes
app.use('/api/positions', positionRoutes);
app.use('/api/quote', quoteRoutes);
app.use('/api/kline', klineRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/screener', screenerRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/notify', notifyRoutes);
app.use('/api/cron', cronConfigRoutes);
app.use('/api/paper', paperRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Start cron scheduler
  const schedules = loadConfig();
  startCron(schedules);

  // Register paper trading engine
  registerPaperEngine();
});
