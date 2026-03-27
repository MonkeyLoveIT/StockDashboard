import React, { useEffect, useState } from 'react'
import { Card, Row, Col, Select, Button, Statistic, Table, Tag, Space, Spin, message } from 'antd'
import { PlayCircleOutlined, BellOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import { positionApi, klineApi, notifyApi } from '../services/api'

// ====== 指标计算 ======
const calcMA = (klines, period) =>
  klines.map((_, i) => {
    if (i < period - 1) return null
    return klines.slice(i - period + 1, i + 1).reduce((s, k) => s + k.close, 0) / period
  })

const calcEMA = (arr, period) => {
  const k = 2 / (period + 1)
  return arr.map((v, i) => i === 0 ? v : v * k + arr[i - 1] * (1 - k))
}

const calcMACD = (klines, fast = 12, slow = 26, signal = 9) => {
  const closes = klines.map(k => k.close)
  const dif = calcEMA(closes, fast).map((v, i) => v - calcEMA(closes, slow)[i])
  const dea = calcEMA(dif, signal)
  return { dif, dea, bar: dif.map((v, i) => (v - dea[i]) * 2) }
}

const calcKDJ = (klines, period = 9) => {
  const k = [], d = [], j = []
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) { k.push(null); d.push(null); j.push(null); continue }
    const hi = Math.max(...klines.slice(i - period + 1, i + 1).map(k => k.high))
    const lo = Math.min(...klines.slice(i - period + 1, i + 1).map(k => k.low))
    const close = klines[i].close
    const rsv = hi === lo ? 50 : (close - lo) / (hi - lo) * 100
    k.push((k[i - 1] || 50) * 2 / 3 + rsv / 3)
    d.push((d[i - 1] || 50) * 2 / 3 + k[i] / 3)
    j.push(k[i] * 3 - d[i] * 2)
  }
  return { k, d, j }
}

// ====== 统计计算（独立函数，非方法）======
function calcStats(trades, finalCapital, initCapital) {
  if (!trades || trades.length === 0) {
    return {
      totalReturn: 0, annualReturn: 0, sharpe: 0,
      maxDrawdown: 0, winRate: 0, totalTrades: 0,
      finalCapital: initCapital, trades: [], navCurve: [{ date: '-', nav: initCapital }]
    }
  }

  const totalReturn = (finalCapital - initCapital) / initCapital * 100

  // 买卖匹配算胜率
  const buys = trades.filter(t => t.action === 'BUY')
  const sells = trades.filter(t => t.action === 'SELL')
  let winCount = 0
  sells.forEach((sell, idx) => {
    const buy = buys[idx]
    if (buy && sell.amount > buy.amount) winCount++
  })
  const totalTrades = sells.length
  const winRate = totalTrades > 0 ? winCount / totalTrades * 100 : 0

  // 最大回撤
  let peak = initCapital, maxDrawdown = 0
  const navCurve = [{ date: trades[0]?.date || '-', nav: initCapital }]
  let nav = initCapital
  trades.forEach(trade => {
    nav = trade.action === 'BUY' ? nav - trade.amount : nav + trade.amount
    if (nav > peak) peak = nav
    const dd = (peak - nav) / peak * 100
    if (dd > maxDrawdown) maxDrawdown = dd
    navCurve.push({ date: trade.date, nav })
  })

  // 夏普（简化）
  if (navCurve.length < 2) {
    return { totalReturn, annualReturn: 0, sharpe: 0, maxDrawdown, winRate, totalTrades, finalCapital, trades, navCurve }
  }
  const rets = navCurve.slice(1).map((n, i) => (n.nav - navCurve[i].nav) / navCurve[i].nav)
  const avgR = rets.reduce((s, r) => s + r, 0) / (rets.length || 1)
  const stdR = Math.sqrt(rets.reduce((s, r) => s + (r - avgR) ** 2, 0) / (rets.length || 1))
  const sharpe = stdR > 0 ? avgR / stdR * Math.sqrt(242) : 0
  const annualReturn = totalReturn * 242 / Math.max(trades.length, 1)

  return { totalReturn, annualReturn, sharpe, maxDrawdown, winRate, totalTrades, finalCapital, trades, navCurve }
}

// ====== 策略 ======
const strategies = {
  ma_cross: {
    name: 'MA均线金叉/死叉',
    params: [
      { key: 'fast', label: '快线周期', default: 5 },
      { key: 'slow', label: '慢线周期', default: 20 }
    ],
    run(klines, params) {
      const { fast, slow } = params
      const maFast = calcMA(klines, fast)
      const maSlow = calcMA(klines, slow)
      const trades = []
      let capital = 100000, shares = 0, pos = 0
      const initCapital = capital

      for (let i = slow; i < klines.length; i++) {
        const prevFast = maFast[i - 1], currFast = maFast[i]
        const prevSlow = maSlow[i - 1], currSlow = maSlow[i]
        if (currFast == null || currSlow == null) continue
        const price = klines[i].close, date = klines[i].date

        if (prevFast <= prevSlow && currFast > currSlow && pos === 0) {
          shares = Math.floor(capital / price / 100) * 100
          const cost = shares * price * 1.0003
          if (shares > 0) { capital -= cost; trades.push({ date, action: 'BUY', price, shares, amount: cost }); pos = 1 }
        } else if (prevFast >= prevSlow && currFast < currSlow && pos === 1) {
          const proceeds = shares * price * 0.9997
          trades.push({ date, action: 'SELL', price, shares, amount: proceeds })
          capital += proceeds; shares = 0; pos = 0
        }
      }
      if (pos === 1 && shares > 0) {
        const price = klines[klines.length - 1].close
        trades.push({ date: klines[klines.length - 1].date, action: 'SELL', price, shares, amount: shares * price * 0.9997 })
        capital += shares * price * 0.9997
      }
      return calcStats(trades, capital, initCapital)
    }
  },

  macd_cross: {
    name: 'MACD金叉/死叉',
    params: [],
    run(klines) {
      const { dif, dea } = calcMACD(klines)
      const trades = []
      let capital = 100000, shares = 0, pos = 0
      const initCapital = capital

      for (let i = 1; i < klines.length; i++) {
        if (dif[i] == null || dea[i] == null) continue
        const price = klines[i].close, date = klines[i].date
        if (dif[i - 1] <= dea[i - 1] && dif[i] > dea[i] && pos === 0) {
          shares = Math.floor(capital / price / 100) * 100
          const cost = shares * price * 1.0003
          if (shares > 0) { capital -= cost; trades.push({ date, action: 'BUY', price, shares, amount: cost }); pos = 1 }
        } else if (dif[i - 1] >= dea[i - 1] && dif[i] < dea[i] && pos === 1) {
          const proceeds = shares * price * 0.9997
          trades.push({ date, action: 'SELL', price, shares, amount: proceeds })
          capital += proceeds; shares = 0; pos = 0
        }
      }
      if (pos === 1 && shares > 0) {
        const price = klines[klines.length - 1].close
        trades.push({ date: klines[klines.length - 1].date, action: 'SELL', price, shares, amount: shares * price * 0.9997 })
        capital += shares * price * 0.9997
      }
      return calcStats(trades, capital, initCapital)
    }
  },

  kdj_cross: {
    name: 'KDJ金叉/死叉',
    params: [],
    run(klines) {
      const { k, d } = calcKDJ(klines)
      const trades = []
      let capital = 100000, shares = 0, pos = 0
      const initCapital = capital

      for (let i = 1; i < klines.length; i++) {
        if (k[i] == null || d[i] == null || k[i - 1] == null || d[i - 1] == null) continue
        const price = klines[i].close, date = klines[i].date
        if (k[i - 1] <= d[i - 1] && k[i] > d[i] && k[i] < 30 && pos === 0) {
          shares = Math.floor(capital / price / 100) * 100
          const cost = shares * price * 1.0003
          if (shares > 0) { capital -= cost; trades.push({ date, action: 'BUY', price, shares, amount: cost }); pos = 1 }
        } else if (k[i - 1] >= d[i - 1] && k[i] < d[i] && k[i] > 70 && pos === 1) {
          const proceeds = shares * price * 0.9997
          trades.push({ date, action: 'SELL', price, shares, amount: proceeds })
          capital += proceeds; shares = 0; pos = 0
        }
      }
      if (pos === 1 && shares > 0) {
        const price = klines[klines.length - 1].close
        trades.push({ date: klines[klines.length - 1].date, action: 'SELL', price, shares, amount: shares * price * 0.9997 })
        capital += shares * price * 0.9997
      }
      return calcStats(trades, capital, initCapital)
    }
  }
}

// ====== 回测页面 ======
const BacktestPage = () => {
  const [positions, setPositions] = useState([])
  const [selectedCode, setSelectedCode] = useState(null)
  const [selectedStrategy, setSelectedStrategy] = useState('ma_cross')
  const [params, setParams] = useState({ fast: 5, slow: 20 })
  const [result, setResult] = useState(null)
  const [klines, setKlines] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    positionApi.getAll().then(data => {
      setPositions(data)
      if (data.length > 0 && !selectedCode) setSelectedCode(data[0].code)
    })
  }, [])

  const handleRun = async () => {
    if (!selectedCode) { message.warning('请选择股票'); return }
    setLoading(true)
    setResult(null)
    try {
      const res = await klineApi.getKline(selectedCode, 'd', '1')
      const data = res?.klines || []
      if (!data || data.length < 30) {
        message.error('K线数据不足（至少需要30个交易日），请换一只股票试试')
        setLoading(false)
        return
      }
      setKlines(data)
      const s = strategies[selectedStrategy]
      const r = s.run(data, params)
      setResult(r)
    } catch (e) {
      message.error('回测失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSendReport = async () => {
    if (!result) return
    try {
      await notifyApi.send({
        title: `📊 策略回测报告：${selectedCode}`,
        content: `策略: ${strategies[selectedStrategy].name}\n总收益率: ${result.totalReturn.toFixed(2)}%\n年化收益: ${result.annualReturn.toFixed(2)}%\n夏普比率: ${result.sharpe.toFixed(2)}\n最大回撤: ${result.maxDrawdown.toFixed(2)}%\n胜率: ${result.winRate.toFixed(1)}%\n交易次数: ${result.totalTrades}`
      })
      message.success('回测报告已发送至飞书')
    } catch (e) {
      message.error('发送失败: ' + e.message)
    }
  }

  const buildNavOption = () => {
    if (!result?.navCurve?.length) return {}
    return {
      title: { text: '净值曲线', left: 'center' },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: result.navCurve.map(n => n.date), boundaryGap: false },
      yAxis: { type: 'value', scale: true },
      series: [{ name: '净值', type: 'line', data: result.navCurve.map(n => n.nav), smooth: true, symbol: 'none', lineStyle: { color: '#1890ff' } }]
    }
  }

  const statCards = result ? [
    { label: '总收益率', value: `${result.totalReturn > 0 ? '+' : ''}${result.totalReturn.toFixed(2)}%`, color: result.totalReturn >= 0 ? '#e24a4a' : '#52c41a' },
    { label: '年化收益', value: `${result.annualReturn > 0 ? '+' : ''}${result.annualReturn.toFixed(2)}%`, color: result.annualReturn >= 0 ? '#e24a4a' : '#52c41a' },
    { label: '夏普比率', value: result.sharpe.toFixed(2), color: result.sharpe >= 0 ? '#52c41a' : '#e24a4a' },
    { label: '最大回撤', value: `${result.maxDrawdown.toFixed(2)}%`, color: '#e24a4a' },
    { label: '胜率', value: `${result.winRate.toFixed(1)}%`, color: result.winRate >= 50 ? '#52c41a' : '#e24a4a' },
    { label: '交易次数', value: result.totalTrades, color: '#1890ff' },
  ] : []

  const tradeColumns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 110 },
    { title: '方向', dataIndex: 'action', key: 'action', render: a => <Tag color={a === 'BUY' ? 'red' : 'green'}>{a === 'BUY' ? '买入' : '卖出'}</Tag> },
    { title: '价格', dataIndex: 'price', key: 'price', render: p => `¥${p.toFixed(2)}` },
    { title: '数量', dataIndex: 'shares', key: 'shares', render: s => `${s}股` },
    { title: '金额', dataIndex: 'amount', key: 'amount', render: a => `¥${a.toFixed(2)}` },
  ]

  const currentStrategy = strategies[selectedStrategy]

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 style={{ fontSize: 24, margin: 0 }}>策略回测</h1>
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRun} loading={loading}>
          运行回测
        </Button>
      </div>

      <Card className="mb-4">
        <Row gutter={16} align="middle">
          <Col>
            <span>股票：</span>
            <Select value={selectedCode} onChange={setSelectedCode} style={{ width: 200 }}>
              {positions.map(p => <Select.Option key={p.code} value={p.code}>{p.name || p.code}</Select.Option>)}
            </Select>
          </Col>
          <Col>
            <span>策略：</span>
            <Select value={selectedStrategy} onChange={setSelectedStrategy} style={{ width: 200 }}>
              {Object.entries(strategies).map(([k, v]) => <Select.Option key={k} value={k}>{v.name}</Select.Option>)}
            </Select>
          </Col>
          {currentStrategy?.params.map(p => (
            <Col key={p.key}>
              <span>{p.label}：</span>
              <input
                type="number"
                value={params[p.key]}
                onChange={e => setParams(prev => ({ ...prev, [p.key]: parseInt(e.target.value) || p.default }))}
                style={{ width: 60, padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 6 }}
                min={1}
              />
            </Col>
          ))}
          <Col>
            <span style={{ color: '#999' }}>K线数据：{klines.length || '-'} 条</span>
          </Col>
        </Row>
      </Card>

      {loading && <Card><div className="flex justify-center py-8"><Spin size="large" tip="正在回测，请稍候..." /></div></Card>}

      {result && (
        <>
          <Row gutter={12} className="mb-4">
            {statCards.map(s => (
              <Col key={s.label} span={4}>
                <Card size="small">
                  <Statistic title={<span style={{ fontSize: 12 }}>{s.label}</span>} value={s.value} valueStyle={{ color: s.color, fontSize: 20 }} />
                </Card>
              </Col>
            ))}
            <Col span={4}>
              <Card size="small">
                <Button icon={<BellOutlined />} onClick={handleSendReport} block>发送报告</Button>
              </Card>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={16}>
              <Card title="净值曲线" size="small">
                {result.navCurve.length > 1 ? (
                  <ReactECharts option={buildNavOption()} style={{ height: 300 }} opts={{ renderer: 'canvas' }} />
                ) : (
                  <div className="text-center text-gray-400 py-8">无交易记录（数据不足或无信号）</div>
                )}
              </Card>
            </Col>
            <Col span={8}>
              <Card title="买卖记录" size="small" bodyStyle={{ padding: 0 }}>
                <Table columns={tradeColumns} dataSource={result.trades} rowKey={(_, i) => i} pagination={{ pageSize: 8 }} size="small" />
              </Card>
            </Col>
          </Row>
        </>
      )}

      {!result && !loading && (
        <Card>
          <div className="text-center text-gray-400 py-12">
            选择股票和策略后，点击「运行回测」<br />
            <span className="text-sm mt-2 block">回测说明：初始资金10万，佣金0.03%，卖出收0.03%印花税（费率仅供参考）</span>
          </div>
        </Card>
      )}
    </div>
  )
}

export default BacktestPage
