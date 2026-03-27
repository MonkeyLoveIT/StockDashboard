import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// 环境变量（从进程环境读取，Gateway 启动时注入）
const BOT_APP_ID = process.env.FEISHU_APP_ID || 'cli_a9328f245878dbce';
const BOT_APP_SECRET = process.env.FEISHU_APP_SECRET || 'D2dQdTEEWmDjeOQWHBZMDcjTqmt5xPlj';
const USER_OPEN_ID = process.env.FEISHU_USER_OPEN_ID || 'ou_53f73c5d32213fc809dc8ec322a5e4fe';

// 获取 tenant access token
async function getTenantToken() {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: BOT_APP_ID, app_secret: BOT_APP_SECRET })
  });
  const data = await res.json();
  return data.tenant_access_token;
}

// POST /api/notify - 发送飞书提醒
router.post('/notify', async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title && !content) {
      return res.status(400).json({ error: 'title and content required' });
    }

    const token = await getTenantToken();
    const messageContent = `【StockDashboard】\n${title ? title + '\n' : ''}${content || ''}`;

    const larkRes = await fetch('https://open.feishu.cn/open-apis/im/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        receive_id: USER_OPEN_ID,
        msg_type: 'text',
        content: JSON.stringify({ text: messageContent })
      })
    });

    const larkData = await larkRes.json();
    if (larkData.code !== 0) {
      console.error('Feishu send failed:', larkData);
      return res.status(500).json({ error: '发送失败', detail: larkData });
    }

    res.json({ success: true, message_id: larkData.data?.message_id });
  } catch (error) {
    console.error('Notify error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
