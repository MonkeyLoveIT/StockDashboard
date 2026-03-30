import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// 环境变量（从进程环境读取，Gateway 启动时注入）
// 注意：stock 账号用的是 cli_a9401cbc2bb85bb5，用户在那边的 open_id 不同
const BOT_APP_ID = process.env.FEISHU_APP_ID || 'cli_a9401cbc2bb85bb5';
const BOT_APP_SECRET = process.env.FEISHU_APP_SECRET || 'PbcEvqP90YnPlaw1ogjvhdvQynW7Su1V';
const USER_OPEN_ID = process.env.FEISHU_USER_OPEN_ID || 'ou_3c3f9eef639be8ad7e6d539363b66e83';
const CHAT_ID = process.env.FEISHU_CHAT_ID || 'oc_d0b949a0c45b3924c3673838d9663329';

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
    const { title, content, type, template } = req.body;
    if (!title && !content) {
      return res.status(400).json({ error: 'title and content required' });
    }

    const token = await getTenantToken();

    // 卡片格式
    if (type === 'card') {
      const card = {
        header: {
          title: { tag: 'plain_text', content: `【StockDashboard】 ${title}` },
          template: template || 'blue',
        },
        elements: [{
          tag: 'div',
          text: { tag: 'lark_md', content: content || '' }
        }, {
          tag: 'hr'
        }, {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: '仅供参考，不构成投资建议。' }]
        }]
      };
      const cardStr = JSON.stringify(card);
      console.log('[notify] card payload preview:', cardStr.slice(0, 200));

      const larkRes = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          receive_id: CHAT_ID,
          msg_type: 'interactive',
          content: JSON.stringify(card)
        })
      });

      const larkData = await larkRes.json();
      if (larkData.code !== 0) {
        console.error('Feishu card send failed:', larkData);
        return res.status(500).json({ error: '发送失败', detail: larkData });
      }

      return res.json({ success: true, message_id: larkData.data?.message_id });
    }

    // 文本格式（兼容旧调用）
    const messageContent = `【StockDashboard】\n${title ? title + '\n' : ''}${content || ''}`;
    const larkRes = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        receive_id: CHAT_ID,
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
