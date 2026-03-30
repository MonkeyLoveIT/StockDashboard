import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, 'cron-config.json');

// ============ Default Config ============
export const DEFAULT_SCHEDULES = [
  {
    name: '盘前简报',
    schedule: '55 8 * * 1-5',
    modes: ['oversold_rebound', 'uptrend'],
    limit: 20,
    enabled: true,
  },
  {
    name: '午盘总结',
    schedule: '35 12 * * 1-5',
    modes: ['hot_money', 'breakthrough'],
    limit: 20,
    enabled: true,
  },
  {
    name: '收盘复盘',
    schedule: '15 15 * * 1-5',
    modes: ['oversold_rebound', 'uptrend', 'hot_money', 'breakthrough', 'long_value'],
    limit: 20,
    enabled: true,
  },
];

const MODE_LABELS = {
  oversold_rebound: '底部反弹',
  uptrend: '趋势上涨',
  hot_money: '热门资金',
  breakthrough: '突破买入',
  long_value: '长线价值',
};

// ============ Config Persistence ============
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return data.schedules || DEFAULT_SCHEDULES;
    }
  } catch (e) {
    console.error('[cron] Failed to load config:', e.message);
  }
  // Initialize with defaults
  saveConfig(DEFAULT_SCHEDULES);
  return DEFAULT_SCHEDULES;
}

export function saveConfig(schedules) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ schedules }, null, 2), 'utf-8');
  } catch (e) {
    console.error('[cron] Failed to save config:', e.message);
  }
}

// ============ Report Formatting ============
function formatReport(taskName, modes, results, total) {
  const modeLabelStr = modes.map(m => MODE_LABELS[m] || m).join('、');
  const top5 = results.slice(0, 5);

  const lines = top5.map((stock, i) => {
    const changeStr = stock.change >= 0 ? `+${stock.change.toFixed(2)}` : stock.change.toFixed(2);
    const pctStr = stock.changePct >= 0 ? `+${stock.changePct.toFixed(2)}` : stock.changePct.toFixed(2);
    const reasons = (stock.reasons || []).slice(0, 2).join('; ');
    return `${i + 1}. ${stock.name}(${stock.code}) ¥${stock.price.toFixed(2)} ${changeStr}(${pctStr}%) 综合评分${stock.avgScore}${reasons ? `\n   推荐理由：${reasons}` : ''}`;
  });

  return [
    `📊 ${taskName} 智能选股报告`,
    '',
    `筛选模式：${modeLabelStr}`,
    '符合条件股票 TOP 5：',
    ...lines,
    '',
    `共筛出 ${total} 只股票，仅展示前 5`,
    '仅供参考，不构成投资建议。',
  ].join('\n');
}

// ============ Run Single Task ============
async function runTask(schedule) {
  console.log(`[cron] Running task: ${schedule.name} at ${new Date().toISOString()}`);
  try {
    // Call screener API
    const screenerUrl = new URL('http://localhost:3001/api/screener/run');
    schedule.modes.forEach(m => screenerUrl.searchParams.append('mode', m));
    screenerUrl.searchParams.set('limit', String(schedule.limit));

    const resp = await fetch(screenerUrl.toString());
    if (!resp.ok) {
      console.error(`[cron] Screener API error: ${resp.status}`);
      return;
    }

    const data = await resp.json();
    const results = data.results || [];
    const total = data.total || results.length;

    // Format report
    const content = formatReport(schedule.name, schedule.modes, results, total);
    const title = `📊 ${schedule.name} 智能选股报告`;

    // Send notification via notify API
    const notifyResp = await fetch('http://localhost:3001/api/notify/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });

    if (!notifyResp.ok) {
      console.error(`[cron] Notify API error: ${notifyResp.status}`);
    } else {
      console.log(`[cron] Task ${schedule.name} completed, sent ${results.length} results`);
    }
  } catch (e) {
    console.error(`[cron] Task ${schedule.name} failed:`, e.message);
  }
}

// ============ Cron Scheduler ============
let registeredTasks = [];

export function startCron(schedules) {
  // Stop existing tasks
  registeredTasks.forEach(task => task.stop());
  registeredTasks = [];

  schedules.forEach((schedule, idx) => {
    if (!schedule.enabled) {
      console.log(`[cron] Skipping disabled task: ${schedule.name}`);
      return;
    }

    // Validate cron expression
    if (!cron.validate(schedule.schedule)) {
      console.error(`[cron] Invalid cron expression for ${schedule.name}: ${schedule.schedule}`);
      return;
    }

    const task = cron.schedule(schedule.schedule, () => {
      runTask(schedule);
    }, {
      timezone: 'Asia/Shanghai',
    });

    registeredTasks.push(task);
    console.log(`[cron] Registered task: ${schedule.name} (${schedule.schedule})`);
  });

  console.log(`[cron] Started ${registeredTasks.length} cron tasks`);
}

// Hot-reload: update and restart
export function restartCron(schedules) {
  startCron(schedules);
}
