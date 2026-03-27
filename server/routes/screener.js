import express from 'express'
import fetch from 'node-fetch'

const router = express.Router()

// Sina quote fetcher (uses GBK encoding)
async function fetchSinaQuote(code) {
  let prefix = 'sh'
  if (code.startsWith('0') || code.startsWith('3') || code.startsWith('002') || code.startsWith('301')) {
    prefix = 'sz'
  }

  const url = `https://hq.sinajs.cn/list=${prefix}${code}`
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://finance.sina.com.cn/'
      }
    })
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    const decoder = new TextDecoder('gbk')
    const raw = decoder.decode(buffer)
    const match = raw.match(/"([^"]+)"/)
    if (!match) return null

    const fields = match[1].split(',')
    if (fields.length < 32) return null

    const name = fields[0]
    const open = parseFloat(fields[1]) || 0
    const yesterdayClose = parseFloat(fields[2]) || 0
    const current = parseFloat(fields[3]) || 0
    const high = parseFloat(fields[4]) || 0
    const low = parseFloat(fields[5]) || 0
    const buy1 = parseFloat(fields[6]) || 0
    const sell1 = parseFloat(fields[7]) || 0
    const volume = parseInt(fields[8]) || 0     // 成交量（手）
    const amount = parseFloat(fields[9]) || 0   // 成交额（元）

    const change = current - yesterdayClose
    const changePct = yesterdayClose !== 0 ? (change / yesterdayClose * 100) : 0

    // Sina doesn't provide PE/PB/volRatio/turnover/profitGrowth in real-time quote
    // Use '-' as placeholder, front-end will display '暂无数据'
    return {
      code,
      name,
      price: current,
      change,
      changePct,
      open,
      high,
      low,
      close: yesterdayClose,
      volume,
      amount,
      volRatio: '-',        // 量比（Sina实时行情不提供）
      turnover: '-',        // 换手率（Sina实时行情不提供）
      pe: '-',              // 市盈率（需要财务数据接口）
      pb: '-',              // 市净率（需要财务数据接口）
      profitGrowth: '-'     // 净利润增速（需要财务数据接口）
    }
  } catch (e) {
    return null
  }
}

// GET /api/screener/short - 短线技术选股
// Query: minPct=3&minVolRatio=1.5&minTurnover=2
router.get('/short', async (req, res) => {
  try {
    const { minPct = 3, minVolRatio = 1.5, minTurnover = 2, limit = 50 } = req.query
    const stockList = await getActiveStocks()
    const results = []
    const toFetch = stockList.slice(0, parseInt(limit))

    // 并发请求（限制并发数防止被限流）
    const chunkSize = 10
    for (let i = 0; i < toFetch.length; i += chunkSize) {
      const chunk = toFetch.slice(i, i + chunkSize)
      const quotes = await Promise.all(chunk.map(fetchSinaQuote))
      for (const quote of quotes) {
        if (!quote || quote.price <= 0) continue

        const meetsCriteria =
          quote.changePct >= parseFloat(minPct) &&
          (quote.volRatio === '-' || parseFloat(quote.volRatio) >= parseFloat(minVolRatio)) &&
          (quote.turnover === '-' || parseFloat(quote.turnover) >= parseFloat(minTurnover))

        if (meetsCriteria) {
          results.push({
            ...quote,
            reason: `涨幅${quote.changePct.toFixed(2)}%`,
            riskLevel: quote.changePct > 8 ? '高' : quote.changePct > 5 ? '中' : '低',
            suitableStrategy: '短线'
          })
        }
      }
    }

    results.sort((a, b) => b.changePct - a.changePct)
    res.json({ results: results.slice(0, 10), total: results.length })
  } catch (error) {
    console.error('Error in short screener:', error)
    res.status(500).json({ error: 'Screener failed' })
  }
})

// GET /api/screener/value - 低估价值选股（Sina实时行情无PE/PB数据，暂时返回提示）
router.get('/value', async (req, res) => {
  try {
    // Sina 实时行情不含财务数据，PE/PB 需另接财务接口
    // 这里返回热门大盘股作为演示
    const stockList = await getActiveStocks()
    const results = []
    const toFetch = stockList.slice(0, 30)

    const chunkSize = 10
    for (let i = 0; i < toFetch.length; i += chunkSize) {
      const chunk = toFetch.slice(i, i + chunkSize)
      const quotes = await Promise.all(chunk.map(fetchSinaQuote))
      for (const quote of quotes) {
        if (!quote || quote.price <= 0) continue
        results.push({
          ...quote,
          reason: 'PE/PB 财务数据需接入财务接口后展示',
          riskLevel: '低',
          suitableStrategy: '长线'
        })
      }
    }

    results.sort((a, b) => b.changePct - a.changePct)
    res.json({
      results: results.slice(0, 10),
      total: results.length,
      notice: 'Sina实时行情不含PE/PB/换手率等财务指标，请切换至「短线技术选股」模式'
    })
  } catch (error) {
    console.error('Error in value screener:', error)
    res.status(500).json({ error: 'Screener failed' })
  }
})

// GET /api/screener/combined - A+B综合筛选
router.get('/combined', async (req, res) => {
  try {
    const { minPct = 3, minVolRatio = 1.5, minTurnover = 2, limit = 50 } = req.query
    const stockList = await getActiveStocks()
    const results = []
    const toFetch = stockList.slice(0, parseInt(limit))

    const chunkSize = 10
    for (let i = 0; i < toFetch.length; i += chunkSize) {
      const chunk = toFetch.slice(i, i + chunkSize)
      const quotes = await Promise.all(chunk.map(fetchSinaQuote))
      for (const quote of quotes) {
        if (!quote || quote.price <= 0) continue

        const shortMeets =
          quote.changePct >= parseFloat(minPct) &&
          (quote.volRatio === '-' || parseFloat(quote.volRatio) >= parseFloat(minVolRatio)) &&
          (quote.turnover === '-' || parseFloat(quote.turnover) >= parseFloat(minTurnover))

        if (shortMeets) {
          results.push({
            ...quote,
            reason: `涨幅${quote.changePct.toFixed(2)}%（短线筛选模式）`,
            riskLevel: quote.changePct > 8 ? '高' : '中',
            suitableStrategy: '中线'
          })
        }
      }
    }

    results.sort((a, b) => b.changePct - a.changePct)
    res.json({ results: results.slice(0, 10), total: results.length })
  } catch (error) {
    console.error('Error in combined screener:', error)
    res.status(500).json({ error: 'Screener failed' })
  }
})

// 热门活跃股列表
async function getActiveStocks() {
  return [
    '600000', '600016', '600019', '600028', '600030', '600031', '600036', '600048', '600050', '600104',
    '600109', '600111', '600150', '600160', '600183', '600196', '600276', '600309', '600519', '600547',
    '600570', '600585', '600588', '600690', '600703', '600760', '600809', '600837', '600887', '600893',
    '600905', '600918', '600926', '600989', '601006', '601012', '601066', '601088', '601118', '601138',
    '601166', '601186', '601211', '601236', '601288', '601318', '601328', '601336', '601398', '601601',
    '601628', '601658', '601668', '601688', '601728', '601766', '601800', '601816', '601818', '601857',
    '601888', '601899', '601939', '601985', '601988', '601989', '601995', '603259', '603288', '603501',
    '603799', '603986', '688041', '688599', '688981',
    '000001', '000002', '000063', '000100', '000333', '000338', '000425', '000568', '000651', '000661',
    '000708', '000725', '000768', '000858', '000876', '000895',
    '002475', '002594', '002714', '002230', '002415', '002460', '002466', '002475', '002594'
  ]
}

export default router
