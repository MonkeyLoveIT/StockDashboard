import express from 'express'
import fetch from 'node-fetch'

const router = express.Router()

// GET /api/search?code=xxx
router.get('/', async (req, res) => {
  try {
    const { code } = req.query

    if (!code) {
      return res.status(400).json({ error: 'code parameter is required' })
    }

    const searchCode = code.trim()

    // 判断市场和前缀
    let prefix = 'sh'
    let market = 'Shanghai'
    if (/^\d{6}$/.test(searchCode)) {
      if (searchCode.startsWith('6') || searchCode.startsWith('9') || searchCode.startsWith('8')) {
        prefix = 'sh'
        market = 'Shanghai'
      } else {
        prefix = 'sz'
        market = 'Shenzhen'
      }
    }

    // 用新浪实时行情接口获取名称
    const url = `https://hq.sinajs.cn/list=${prefix}${searchCode}`
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://finance.sina.com.cn/'
        }
      })

      if (response.ok) {
        const buffer = await response.arrayBuffer()
        const decoder = new TextDecoder('gbk')
        const raw = decoder.decode(buffer)
        const match = raw.match(/"([^"]+)"/)
        if (match) {
          const fields = match[1].split(',')
          if (fields.length > 0 && fields[0]) {
            const results = [{
              code: searchCode,
              name: fields[0],
              market,
              type: 'Stock'
            }]
            return res.json({ results, query: code })
          }
        }
      }
    } catch (e) {
      console.log('Sina API error:', e.message)
    }

    // Fallback: 无法获取名称时，也返回股票代码本身
    if (/^\d{6}$/.test(searchCode)) {
      return res.json({
        results: [{
          code: searchCode,
          name: searchCode,
          market,
          type: 'Stock'
        }],
        query: code
      })
    }

    res.json({ results: [], query: code })
  } catch (error) {
    console.error('Error searching stock:', error)
    res.status(500).json({ error: 'Failed to search stock' })
  }
})

export default router
