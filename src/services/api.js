// API Service Layer — positions 重构为交易流水式
const API_BASE = '/api'

// ============================================================
// Positions / Transactions API
// ============================================================
export const positionApi = {
  // GET /api/positions — 获取持仓汇总（实时计算）
  getAll: async () => {
    const res = await fetch(`${API_BASE}/positions`)
    if (!res.ok) throw new Error('Failed to fetch positions')
    return res.json()
  },

  // GET /api/positions/:id — 获取单笔交易
  getById: async (id) => {
    const res = await fetch(`${API_BASE}/positions/${id}`)
    if (!res.ok) throw new Error('Failed to fetch transaction')
    return res.json()
  },

  // POST /api/positions — 录入新交易（买入/卖出）
  // body: { code, name, type: 'buy'|'sell', price, shares, fee?, note?, traded_at? }
  create: async (data) => {
    const res = await fetch(`${API_BASE}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error || 'Failed to create transaction')
    }
    return res.json()
  },

  // PUT /api/positions/:id — 仅允许修改备注
  update: async (id, data) => {
    const res = await fetch(`${API_BASE}/positions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!res.ok) throw new Error('Failed to update transaction')
    return res.json()
  },

  // DELETE /api/positions/:id — 删除单笔交易
  delete: async (id) => {
    const res = await fetch(`${API_BASE}/positions/${id}`, {
      method: 'DELETE'
    })
    if (!res.ok) throw new Error('Failed to delete transaction')
    return res.json()
  },

  // DELETE /api/positions/code/:code — 清空某只股票所有交易
  deleteByCode: async (code) => {
    const res = await fetch(`${API_BASE}/positions/code/${code}`, {
      method: 'DELETE'
    })
    if (!res.ok) throw new Error('Failed to delete position')
    return res.json()
  },

  // GET /api/positions/history — 获取全部交易流水（分页）
  getHistory: async (page = 1, pageSize = 50) => {
    const res = await fetch(`${API_BASE}/positions/history?page=${page}&pageSize=${pageSize}`)
    if (!res.ok) throw new Error('Failed to fetch transaction history')
    return res.json()
  },

  // GET /api/positions/history/:code — 获取某只股票的交易历史
  getHistoryByCode: async (code) => {
    const res = await fetch(`${API_BASE}/positions/history/${encodeURIComponent(code)}`)
    if (!res.ok) throw new Error('Failed to fetch stock history')
    return res.json()
  }
}

// ============================================================
// Quote API — 实时行情
// ============================================================
export const quoteApi = {
  getQuote: async (code) => {
    const res = await fetch(`${API_BASE}/quote/${code}`)
    if (!res.ok) throw new Error('Failed to fetch quote')
    return res.json()
  },

  // 批量获取多只股票行情
  getQuotes: async (codes) => {
    const results = await Promise.allSettled(
      codes.map(code => quoteApi.getQuote(code))
    )
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(q => q && !q.error)
  }
}

// ============================================================
// K-Line API
// ============================================================
export const klineApi = {
  // period: 1min/5min/10min/15min/30min/60min/d/w/m
  // fq: 0(不复权)/1(前复权)/2(后复权)
  getKline: async (code, period = 'd', fq = '1') => {
    const res = await fetch(`${API_BASE}/kline/${code}?period=${period}&fq=${fq}`)
    if (!res.ok) throw new Error('Failed to fetch kline')
    return res.json()
  }
}

// ============================================================
// Search API — 搜索股票
// ============================================================
export const searchApi = {
  search: async (code) => {
    const res = await fetch(`${API_BASE}/search?code=${encodeURIComponent(code)}`)
    if (!res.ok) throw new Error('Failed to search')
    return res.json()
  }
}

// ============================================================
// Market Overview API — 大盘指数
// ============================================================
export const marketApi = {
  getOverview: async () => {
    const res = await fetch(`${API_BASE}/market/overview`)
    if (!res.ok) throw new Error('Failed to fetch market overview')
    return res.json()
  }
}

// ============================================================
// Notify API — 飞书提醒推送
// ============================================================
export const notifyApi = {
  send: async ({ title, content }) => {
    const res = await fetch(`${API_BASE}/notify/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content })
    })
    if (!res.ok) throw new Error('Failed to send notification')
    return res.json()
  }
}

// ============================================================
// Screener API — 股票筛选
// ============================================================
export const screenerApi = {
  run: async (modes = ['oversold_rebound'], limit = 50) => {
    const modeParams = (Array.isArray(modes) ? modes : [modes]).map(m => `mode=${m}`).join('&')
    const res = await fetch(`${API_BASE}/screener/run?${modeParams}&limit=${limit}`)
    if (!res.ok) throw new Error('Failed to screen stocks')
    return res.json()
  },

  hot: async (limit = 100) => {
    const res = await fetch(`${API_BASE}/screener/hot?limit=${limit}`)
    if (!res.ok) throw new Error('Failed to fetch hot stocks')
    return res.json()
  }
}

// ============================================================
// Paper Trading API — 模拟实盘
// ============================================================
export const paperApi = {
  getConfig: async () => {
    const res = await fetch(`${API_BASE}/paper/config`)
    if (!res.ok) throw new Error('Failed to fetch config')
    return res.json()
  },

  updateConfig: async (updates) => {
    const res = await fetch(`${API_BASE}/paper/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
    if (!res.ok) throw new Error('Failed to update config')
    return res.json()
  },

  getPositions: async () => {
    const res = await fetch(`${API_BASE}/paper/positions`)
    if (!res.ok) throw new Error('Failed to fetch positions')
    return res.json()
  },

  getOrders: async (page = 1, pageSize = 20) => {
    const res = await fetch(`${API_BASE}/paper/orders?page=${page}&pageSize=${pageSize}`)
    if (!res.ok) throw new Error('Failed to fetch orders')
    return res.json()
  },

  getSummary: async () => {
    const res = await fetch(`${API_BASE}/paper/summary`)
    if (!res.ok) throw new Error('Failed to fetch summary')
    return res.json()
  },

  reset: async () => {
    const res = await fetch(`${API_BASE}/paper/reset`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to reset')
    return res.json()
  },

  getEquityCurve: async () => {
    const res = await fetch(`${API_BASE}/paper/equity_curve`)
    if (!res.ok) throw new Error('Failed to fetch equity curve')
    return res.json()
  },
}
