// API Service Layer - 统一管理所有后端 API 调用

const API_BASE = '/api'

// Positions API
export const positionApi = {
  // 获取所有持仓
  getAll: async () => {
    const res = await fetch(`${API_BASE}/positions`)
    if (!res.ok) throw new Error('Failed to fetch positions')
    return res.json()
  },

  // 获取单个持仓
  getById: async (id) => {
    const res = await fetch(`${API_BASE}/positions/${id}`)
    if (!res.ok) throw new Error('Failed to fetch position')
    return res.json()
  },

  // 创建持仓
  create: async (data) => {
    const res = await fetch(`${API_BASE}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!res.ok) throw new Error('Failed to create position')
    return res.json()
  },

  // 更新持仓
  update: async (id, data) => {
    const res = await fetch(`${API_BASE}/positions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!res.ok) throw new Error('Failed to update position')
    return res.json()
  },

  // 删除持仓
  delete: async (id) => {
    const res = await fetch(`${API_BASE}/positions/${id}`, {
      method: 'DELETE'
    })
    if (!res.ok) throw new Error('Failed to delete position')
    return res.json()
  }
}

// Quote API - 实时行情
export const quoteApi = {
  // 获取单只股票行情
  getQuote: async (code) => {
    const res = await fetch(`${API_BASE}/quote/${code}`)
    if (!res.ok) throw new Error('Failed to fetch quote')
    return res.json()
  },

  // 获取多只股票行情
  getQuotes: async (codes) => {
    // 串行获取每只股票的行情
    const results = await Promise.all(
      codes.map(code => quoteApi.getQuote(code).catch(err => ({ code, error: err.message })))
    )
    return results
  }
}

// K-Line API
export const klineApi = {
  // 获取 K 线数据
  // period: 1min/5min/10min/15min/30min/60min/d/w/m
  // fq: 0(不复权)/1(前复权)/2(后复权)
  getKline: async (code, period = 'd', fq = '1') => {
    const res = await fetch(`${API_BASE}/kline/${code}?period=${period}&fq=${fq}`)
    if (!res.ok) throw new Error('Failed to fetch kline')
    return res.json()
  }
}

// Search API - 搜索股票
export const searchApi = {
  search: async (code) => {
    const res = await fetch(`${API_BASE}/search?code=${encodeURIComponent(code)}`)
    if (!res.ok) throw new Error('Failed to search')
    return res.json()
  }
}

// Market Overview API - 大盘指数
export const marketApi = {
  getOverview: async () => {
    const res = await fetch(`${API_BASE}/market/overview`)
    if (!res.ok) throw new Error('Failed to fetch market overview')
    return res.json()
  }
}

// Notify API - 飞书提醒推送
export const notifyApi = {
  send: async ({ title, content }) => {
    const res = await fetch(`${API_BASE}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content })
    })
    if (!res.ok) throw new Error('Failed to send notification')
    return res.json()
  }
}

// Screener API - 股票筛选
export const screenerApi = {
  // 短线技术选股
  short: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const res = await fetch(`${API_BASE}/screener/short?${qs}`)
    if (!res.ok) throw new Error('Failed to screen stocks')
    return res.json()
  },
  // 低估价值选股
  value: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const res = await fetch(`${API_BASE}/screener/value?${qs}`)
    if (!res.ok) throw new Error('Failed to screen stocks')
    return res.json()
  },
  // A+B综合筛选
  combined: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const res = await fetch(`${API_BASE}/screener/combined?${qs}`)
    if (!res.ok) throw new Error('Failed to screen stocks')
    return res.json()
  }
}
