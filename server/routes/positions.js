import express from 'express'
import { transactionOps, stockOps, positionOps } from '../db.js'
import { getQuote } from '../proxy.js'

const router = express.Router()

// ---- 持仓汇总 ----
// GET /api/positions
// 返回实时计算的持仓列表（含实时行情）
router.get('/', async (req, res) => {
  try {
    // 1. 从 transactions 实时计算持仓
    const rawPositions = await transactionOps.computeAllPositions()
    if (rawPositions.length === 0) {
      return res.json([])
    }

    // 2. 批量获取每只持仓股的实时行情
    const codes = rawPositions.map(p => p.code)
    const quoteResults = await Promise.allSettled(
      codes.map(code => getQuote(code))
    )

    // 3. 组装完整持仓数据 + 昨日收盘价（用于计算当日盈亏）
    const prevCloseMap = {}
    const positionsWithQuotes = rawPositions.map((pos, i) => {
      const quote = quoteResults[i].status === 'fulfilled' ? quoteResults[i].value : null
      const currentPrice = quote && !quote.error ? quote.price : pos.cost
      const prevClose = quote && !quote.error ? (quote.close || currentPrice) : currentPrice
      const currentAmount = currentPrice * pos.shares
      const profit = (currentPrice - pos.cost) * pos.shares
      const profitPct = pos.cost > 0 ? ((currentPrice - pos.cost) / pos.cost) * 100 : 0
      const todayProfit = (currentPrice - prevClose) * pos.shares
      const todayProfitPct = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0

      return {
        code: pos.code,
        name: quote && !quote.error ? quote.name : pos.code,
        shares: pos.shares,
        cost: pos.cost,
        costAmount: pos.costAmount,
        currentPrice,
        prevClose,
        currentAmount,
        profit,
        profitPct,
        todayProfit,
        todayProfitPct,
        // 仓位比例待计算（见下）
        positionPct: 0
      }
    })

    // 4. 计算仓位比例（总市值作为分母）
    const totalAmount = positionsWithQuotes.reduce((sum, p) => sum + p.currentAmount, 0)
    positionsWithQuotes.forEach(p => {
      p.positionPct = totalAmount > 0 ? (p.currentAmount / totalAmount) * 100 : 0
    })

    res.json(positionsWithQuotes)
  } catch (error) {
    console.error('Error getting positions:', error)
    res.status(500).json({ error: 'Failed to get positions' })
  }
})

// ---- 单笔交易操作 ----
// POST /api/positions — 录入新交易（买入或卖出）
router.post('/', async (req, res) => {
  try {
    const { code, name, type, price, shares, fee, note, traded_at } = req.body
    if (!code || !type || !price || !shares) {
      return res.status(400).json({ error: 'code, type, price, shares are required' })
    }
    if (!['buy', 'sell'].includes(type)) {
      return res.status(400).json({ error: 'type must be "buy" or "sell"' })
    }
    if (shares <= 0) {
      return res.status(400).json({ error: 'shares must be positive' })
    }

    // 缓存股票名称
    if (name) {
      await stockOps.upsert(code, name)
    }

    const tx = await transactionOps.create({ code, name, type, price, shares, fee, note, traded_at })
    res.status(201).json(tx)
  } catch (error) {
    console.error('Error creating transaction:', error)
    res.status(500).json({ error: 'Failed to create transaction' })
  }
})

// ---- 单笔交易查询 ----
// GET /api/positions/:id — 通过 transaction ID 查单笔交易
router.get('/:id', async (req, res) => {
  try {
    // 兼容旧版持仓 ID（走 positions 表），新版本 ID 走 transactions
    const tx = await transactionOps.getAll()
    const found = tx.find(t => t.id === Number(req.params.id))
    if (found) return res.json(found)

    // 旧版兼容
    const legacy = await positionOps.getById(req.params.id)
    if (!legacy) return res.status(404).json({ error: 'Not found' })
    res.json(legacy)
  } catch (error) {
    console.error('Error getting transaction:', error)
    res.status(500).json({ error: 'Failed to get transaction' })
  }
})

// PUT /api/positions/:id — 仅允许修改 note
router.put('/:id', async (req, res) => {
  try {
    const { note } = req.body
    const updated = await transactionOps.updateNote(req.params.id, note || null)
    res.json(updated)
  } catch (error) {
    console.error('Error updating transaction:', error)
    res.status(500).json({ error: 'Failed to update transaction' })
  }
})

// DELETE /api/positions/:id — 删除某笔交易
router.delete('/:id', async (req, res) => {
  try {
    await transactionOps.delete(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting transaction:', error)
    res.status(500).json({ error: 'Failed to delete transaction' })
  }
})

// ---- 交易流水 ----
// GET /api/positions/history — 全部交易流水（分页）
router.get('/history', async (req, res) => {
  try {
    const { page = 1, pageSize = 50 } = req.query
    const offset = (Number(page) - 1) * Number(pageSize)
    const all = await transactionOps.getAll()
    const total = all.length
    const data = all.slice(offset, offset + Number(pageSize))
    res.json({ data, total, page: Number(page), pageSize: Number(pageSize) })
  } catch (error) {
    console.error('Error getting transaction history:', error)
    res.status(500).json({ error: 'Failed to get transaction history' })
  }
})

// GET /api/positions/history/:code — 某只股票的交易历史
router.get('/history/:code', async (req, res) => {
  try {
    const history = await transactionOps.getByCode(req.params.code)
    res.json(history)
  } catch (error) {
    console.error('Error getting stock history:', error)
    res.status(500).json({ error: 'Failed to get stock history' })
  }
})

// DELETE /api/positions/code/:code — 清空某只股票所有交易记录（删除持仓）
router.delete('/code/:code', async (req, res) => {
  try {
    const result = await transactionOps.deleteByCode(req.params.code)
    res.json({ success: true, deleted: result.deleted })
  } catch (error) {
    console.error('Error deleting all transactions for code:', error)
    res.status(500).json({ error: 'Failed to delete transactions' })
  }
})

export default router
