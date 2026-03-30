import express from 'express';
import { loadConfig, saveConfig, restartCron } from '../cron.js';

const router = express.Router();

// GET /api/cron/config - 获取当前所有 schedule 配置
router.get('/config', (req, res) => {
  try {
    const schedules = loadConfig();
    res.json({ schedules });
  } catch (error) {
    console.error('[cronConfig] GET error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/cron/config - 更新配置
router.patch('/config', (req, res) => {
  try {
    const { schedules } = req.body;
    if (!Array.isArray(schedules)) {
      return res.status(400).json({ error: 'schedules must be an array' });
    }

    // Validate each schedule
    for (const s of schedules) {
      if (!s.name || !s.schedule || !Array.isArray(s.modes)) {
        return res.status(400).json({ error: 'Each schedule must have name, schedule, and modes' });
      }
    }

    // Save to file
    saveConfig(schedules);

    // Hot-reload cron tasks
    restartCron(schedules);

    res.json({ success: true, schedules });
  } catch (error) {
    console.error('[cronConfig] PATCH error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
