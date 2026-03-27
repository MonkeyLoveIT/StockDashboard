import React, { useEffect, useState } from 'react'
import { Card, Row, Col, Spin, message, Button, Space, Tag, Tooltip } from 'antd'
import { EyeOutlined, EyeInvisibleOutlined, ReloadOutlined, RiseOutlined, FallOutlined } from '@ant-design/icons'
import { positionApi, quoteApi, marketApi } from '../services/api'
import usePositionStore from '../stores/useStore'

// 颜色辅助函数
const getPriceColor = (value) => value > 0 ? 'red-text' : value < 0 ? 'green-text' : ''

// 掩码辅助函数
const maskValue = (val, masked) => masked ? '******' : val

// 格式化成交额
const formatAmount = (val) => {
  if (!val) return '-'
  if (val >= 1e12) return (val / 1e12).toFixed(2) + '万亿'
  if (val >= 1e8) return (val / 1e8).toFixed(2) + '亿'
  if (val >= 1e4) return (val / 1e4).toFixed(2) + '万'
  return val.toFixed(2)
}

// 格式化成交量
const formatVolume = (val) => {
  if (!val) return '-'
  if (val >= 1e8) return (val / 1e8).toFixed(2) + '亿'
  if (val >= 1e4) return (val / 1e4).toFixed(2) + '万'
  return val.toFixed(0)
}

// 单个指数卡片
const IndexCard = ({ index }) => {
  const isUp = index.change >= 0
  const color = isUp ? '#ec0000' : '#00a870'
  const changeText = isUp ? `+${index.change.toFixed(2)}` : index.change.toFixed(2)
  const pctText = isUp ? `+${index.changePct.toFixed(2)}%` : `${index.changePct.toFixed(2)}%`

  return (
    <Col span={8} style={{ marginBottom: 12 }}>
      <Card size="small" className="hover:shadow-md transition-shadow" styles={{ body: { padding: '12px 16px' } }}>
        <div className="flex justify-between items-start">
          <div>
            <div className="font-bold" style={{ fontSize: 14 }}>{index.name}</div>
            <div className="text-xs text-gray-400">{index.code}</div>
          </div>
          <div className="text-right">
            <div className="font-bold" style={{ fontSize: 16, color }}>{index.price?.toFixed(2)}</div>
            <div className="flex items-center justify-end gap-1">
              {isUp ? <RiseOutlined style={{ color, fontSize: 10 }} /> : <FallOutlined style={{ color, fontSize: 10 }} />}
              <span style={{ fontSize: 12, color }}>{changeText}</span>
              <span style={{ fontSize: 11, color }}>({pctText})</span>
            </div>
          </div>
        </div>
        <div className="flex gap-4 mt-2 text-xs text-gray-400">
          <Tooltip title="今开">
            <span>开 {index.open?.toFixed(2)}</span>
          </Tooltip>
          <Tooltip title="最高">
            <span style={{ color: '#ec0000' }}>高 {index.high?.toFixed(2)}</span>
          </Tooltip>
          <Tooltip title="最低">
            <span style={{ color: '#00a870' }}>低 {index.low?.toFixed(2)}</span>
          </Tooltip>
          <Tooltip title={`成交额: ${formatAmount(index.amount)}`}>
            <span>额 {formatAmount(index.amount)}</span>
          </Tooltip>
        </div>
      </Card>
    </Col>
  )
}

// 今日市场汇总
const MarketSummary = ({ marketData, loading, onRefresh }) => {
  if (!marketData && !loading) return null

  return (
    <div className="mb-6">
      <div className="flex justify-between items-center mb-3">
        <h2 style={{ fontSize: 16, margin: 0 }}>📊 今日市场概况</h2>
        <div className="flex items-center gap-2">
          {marketData?.timestamp && (
            <span className="text-xs text-gray-400">
              {new Date(marketData.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新
            </span>
          )}
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
            刷新
          </Button>
        </div>
      </div>

      {loading && !marketData ? (
        <Card><div className="flex justify-center py-6"><Spin size="small" /></div></Card>
      ) : marketData?.indices?.length ? (
        <Row gutter={[12, 0]}>
          {marketData.indices.map(idx => (
            <IndexCard key={idx.code} index={idx} />
          ))}
        </Row>
      ) : (
        <Card><div className="text-center text-gray-400 py-4">暂无市场数据</div></Card>
      )}
    </div>
  )
}

// 单个持仓卡片
const PositionCard = ({ position, quote, masked }) => {
  if (!quote || quote.error) {
    return (
      <Card size="small" className="mb-3">
        <div className="flex justify-between items-center">
          <div>
            <span className="font-bold text-lg">{position.code}</span>
            <span className="ml-2 text-gray-500">{position.name}</span>
          </div>
          <div className="text-gray-400">行情加载中...</div>
        </div>
        <div className="mt-2 text-sm text-gray-500">
          成本: {maskValue(position.cost, masked)} x {maskValue(position.shares, masked)}股
        </div>
      </Card>
    )
  }

  const currentPrice = quote.price
  const costTotal = position.cost * position.shares
  const currentTotal = currentPrice * position.shares
  const profit = currentTotal - costTotal
  const profitPct = ((currentPrice - position.cost) / position.cost * 100)

  return (
    <Card size="small" className="mb-3 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-center">
        <div>
          <span className="font-bold text-lg">{position.code}</span>
          <span className="ml-2 text-gray-500">{position.name || quote.name}</span>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold">¥{currentPrice.toFixed(2)}</div>
          <div className={`text-sm ${getPriceColor(quote.change)}`}>
            {quote.change > 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.changePct.toFixed(2)}%)
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-sm">
        <div>
          <div className="text-gray-500">持仓</div>
          <div>{maskValue(position.shares, masked)}股</div>
        </div>
        <div>
          <div className="text-gray-500">成本</div>
          <div>¥{maskValue(position.cost.toFixed(2), masked)}</div>
        </div>
        <div>
          <div className="text-gray-500">市值</div>
          <div>¥{maskValue(currentTotal.toFixed(2), masked)}</div>
        </div>
        <div>
          <div className="text-gray-500">当日盈亏</div>
          <div className={`font-bold ${getPriceColor(quote.close && quote.close > 0 ? (quote.price - quote.close) * position.shares : 0)}`}>
            {quote.close && quote.close > 0 ? (
              masked ? '******' : (
                <>
                  {quote.price - quote.close > 0 ? '+' : ''}¥{((quote.price - quote.close) * position.shares).toFixed(2)}
                </>
              )
            ) : '-'}
          </div>
        </div>
        <div className="col-span-4">
          <div className="text-gray-500">浮盈亏</div>
          <div className={`text-lg font-bold ${getPriceColor(profit)}`}>
            {masked ? '******' : (
              <>
                {profit > 0 ? '+' : ''}¥{profit.toFixed(2)}
                <span className="text-base ml-2">({profitPct.toFixed(2)}%)</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

// Dashboard 页面
const Dashboard = () => {
  const { positions, quotes, fetchPositions, updateQuotes } = usePositionStore()
  const [loading, setLoading] = useState(false)
  const [masked, setMasked] = useState(false)
  const [marketData, setMarketData] = useState(null)
  const [marketLoading, setMarketLoading] = useState(false)

  useEffect(() => {
    loadData()
    loadMarketData()
  }, [])

  // 定时刷新行情
  useEffect(() => {
    if (positions.length === 0) return

    const interval = setInterval(() => {
      refreshQuotes()
    }, 30000) // 30秒刷新一次

    return () => clearInterval(interval)
  }, [positions])

  const loadData = async () => {
    setLoading(true)
    try {
      const positions = await fetchPositions(positionApi)
      await refreshQuotes(positions)
    } catch (error) {
      message.error('加载数据失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const loadMarketData = async () => {
    setMarketLoading(true)
    try {
      const data = await marketApi.getOverview()
      setMarketData(data)
    } catch (error) {
      console.error('Failed to load market data:', error)
    } finally {
      setMarketLoading(false)
    }
  }

  const refreshQuotes = async (positionsToUse = positions) => {
    if (positionsToUse.length === 0) return

    const codes = positionsToUse.map(p => p.code)
    try {
      const quotesList = await quoteApi.getQuotes(codes)
      updateQuotes(quotesList)
    } catch (error) {
      console.error('Failed to refresh quotes:', error)
    }
  }

  const handleRefresh = async () => {
    setLoading(true)
    try {
      await fetchPositions(positionApi)
      await refreshQuotes()
      await loadMarketData()
      message.success('数据已刷新')
    } catch (error) {
      message.error('刷新失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleMarketRefresh = () => {
    loadMarketData()
  }

  // 计算总账户盈亏（成本 vs 市值）
  const calculateTotalProfit = () => {
    let totalCost = 0
    let totalCurrent = 0

    positions.forEach(p => {
      const quote = quotes[p.code]
      if (quote && !quote.error) {
        totalCost += p.cost * p.shares
        totalCurrent += quote.price * p.shares
      }
    })

    return {
      cost: totalCost,
      current: totalCurrent,
      profit: totalCurrent - totalCost,
      profitPct: totalCost > 0 ? ((totalCurrent - totalCost) / totalCost * 100) : 0
    }
  }

  // 计算当日盈亏（昨收价 vs 当前价）
  const calculateTodayProfit = () => {
    let todayProfit = 0

    positions.forEach(p => {
      const quote = quotes[p.code]
      if (quote && !quote.error && quote.close && quote.close > 0) {
        todayProfit += (quote.price - quote.close) * p.shares
      }
    })

    return todayProfit
  }

  const total = calculateTotalProfit()
  const todayProfit = calculateTodayProfit()

  if (loading && positions.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 style={{ fontSize: 24, margin: 0 }}>持仓概览 Dashboard</h1>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
          >
            刷新数据
          </Button>
          <Button
            icon={masked ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => setMasked(m => !m)}
          >
            {masked ? '显示敏感信息' : '隐藏敏感信息'}
          </Button>
        </Space>
      </div>

      {/* 今日市场汇总 */}
      <MarketSummary
        marketData={marketData}
        loading={marketLoading}
        onRefresh={handleMarketRefresh}
      />

      {/* 总账户盈亏卡片 */}
      <Row gutter={16} className="mb-6">
        <Col span={6}>
          <Card>
            <div className="text-gray-500 text-sm">总成本</div>
            <div className="text-2xl font-bold">¥{maskValue(total.cost.toFixed(2), masked)}</div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div className="text-gray-500 text-sm">总市值</div>
            <div className="text-2xl font-bold">¥{maskValue(total.current.toFixed(2), masked)}</div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div className="text-gray-500 text-sm">总盈亏</div>
            <div className={`text-2xl font-bold ${getPriceColor(total.profit)}`}>
              {masked ? '******' : (
                <>
                  {total.profit > 0 ? '+' : ''}¥{total.profit.toFixed(2)}
                  <span className="text-base ml-2">({total.profitPct.toFixed(2)}%)</span>
                </>
              )}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <div className="text-gray-500 text-sm">当日盈亏</div>
            <div className={`text-2xl font-bold ${getPriceColor(todayProfit)}`}>
              {masked ? '******' : (
                <>
                  {todayProfit > 0 ? '+' : ''}¥{todayProfit.toFixed(2)}
                </>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* 持仓列表 */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>持仓明细</h2>
      {positions.length === 0 ? (
        <Card>
          <div className="text-center text-gray-400 py-8">
            暂无持仓，去添加一些吧！
          </div>
        </Card>
      ) : (
        <Row gutter={16}>
          {positions.map(position => (
            <Col key={position.id} span={8}>
              <PositionCard position={position} quote={quotes[position.code]} masked={masked} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  )
}

export default Dashboard
