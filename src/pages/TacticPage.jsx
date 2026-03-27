import React, { useEffect, useState } from 'react'
import { Radio, Card, Spin, Tag, Space, Row, Col, Statistic, message, Descriptions, Badge, Alert } from 'antd'
import { RiseOutlined, FallOutlined, SwapOutlined } from '@ant-design/icons'
import { positionApi, klineApi, quoteApi } from '../services/api'
import usePositionStore from '../stores/useStore'

// ====== 指标计算 ======
const calcMA = (klines, period) => {
  return klines.map((_, i) => {
    if (i < period - 1) return null
    const sum = klines.slice(i - period + 1, i + 1).reduce((s, k) => s + k.close, 0)
    return sum / period
  })
}

const calcEMA = (arr, period) => {
  const k = 2 / (period + 1)
  return arr.map((v, i) => {
    if (i === 0) return v
    return v * k + arr[i - 1] * (1 - k)
  })
}

const calcMACD = (klines, fast = 12, slow = 26, signal = 9) => {
  const closes = klines.map(k => k.close)
  const dif = calcEMA(closes, fast).map((v, i) => v - calcEMA(closes, slow)[i])
  const dea = calcEMA(dif, signal)
  const bar = dif.map((v, i) => (v - dea[i]) * 2)
  return { dif, dea, bar }
}

const calcKDJ = (klines, period = 9) => {
  const k = [], d = [], j = []
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) { k.push(null); d.push(null); j.push(null); continue }
    const slice = klines.slice(i - period + 1, i + 1)
    const high = Math.max(...slice.map(k => k.high))
    const low = Math.min(...slice.map(k => k.low))
    const close = klines[i].close
    const rsv = high === low ? 50 : (close - low) / (high - low) * 100
    const prevK = k[i - 1] || 50
    const prevD = d[i - 1] || 50
    k.push(prevK * 2 / 3 + rsv / 3)
    d.push(prevD * 2 / 3 + k[i] / 3)
    j.push(k[i] * 3 - d[i] * 2)
  }
  return { k, d, j }
}

// 计算所有信号（通用，供展示和策略共用）
const calcSignals = (klines) => {
  if (!klines || klines.length < 20) return null

  const ma5 = calcMA(klines, 5)
  const ma10 = calcMA(klines, 10)
  const ma20 = calcMA(klines, 20)
  const { k, d, j } = calcKDJ(klines)
  const { dif, dea, bar } = calcMACD(klines)

  const last = klines.length - 1
  const prev = last - 1

  const ma5v = ma5[last], ma10v = ma10[last], ma20v = ma20[last]
  const kval = k[last], dval = d[last]
  const difv = dif[last], deav = dea[last], barv = bar[last]

  // MA信号
  const maTrend = ma5v > ma10v && ma10v > ma20v ? '多头排列' : ma5v < ma10v && ma10v < ma20v ? '空头排列' : '均线缠绕'
  const maGoldCross = ma5[prev] <= ma10[prev] && ma5v > ma10v
  const maDeathCross = ma5[prev] >= ma10[prev] && ma5v < ma10v

  // KDJ信号
  const kdjStatus = kval > 80 ? '超买区' : kval < 20 ? '超卖区' : '正常区间'
  const kdjGoldCross = k[prev] <= d[prev] && kval > dval
  const kdjDeathCross = k[prev] >= d[prev] && kval < dval

  // MACD信号
  const macdStatus = barv > 0 ? '红柱（多头）' : barv < 0 ? '绿柱（空头）' : '零轴附近'
  const macdCrossUp = dif[prev] <= dea[prev] && difv > deav
  const macdCrossDown = dif[prev] >= dea[prev] && difv < deav

  return {
    ma: { ma5: ma5v, ma10: ma10v, ma20: ma20v, trend: maTrend, goldCross: maGoldCross, deathCross: maDeathCross },
    kdj: { k: kval, d: dval, status: kdjStatus, goldCross: kdjGoldCross, deathCross: kdjDeathCross },
    macd: { dif: difv, dea: deav, bar: barv, status: macdStatus, crossUp: macdCrossUp, crossDown: macdCrossDown },
  }
}

// ====== 策略计算 ======
const calcStrategyA = (klines, quote) => {
  if (!klines || klines.length < 20) return null
  const signals = calcSignals(klines)
  const recent20 = klines.slice(-20)
  const recent10 = klines.slice(-10)
  const low20 = Math.min(...recent20.map(k => k.low))
  const high10 = Math.max(...recent10.map(k => k.high))
  const ma5 = calcMA(klines, 5)
  const ma5Val = ma5[ma5.length - 1]
  const support = Math.min(low20, ma5Val || low20)
  const resistance = Math.max(high10, ma5Val || high10)
  const current = quote.price
  const buyPoint = +(support * 1.01).toFixed(2)
  const sellPoint = +(resistance * 0.99).toFixed(2)
  const stopLoss = +(support * 0.97).toFixed(2)
  return {
    buyPoint, sellPoint, stopLoss,
    support, resistance,
    signals,
    confidence: klines.length > 60 ? '高' : klines.length > 30 ? '中' : '低',
    logic: `支撑位=${support.toFixed(2)} 压力位=${resistance.toFixed(2)}，当前${signals?.ma?.trend}`,
    riskTip: '注意突破有效性，量能配合是关键'
  }
}

const calcStrategyB = (klines, quote, position) => {
  if (!klines || klines.length < 5) return null
  const signals = calcSignals(klines)
  const cost = position.cost
  const current = quote.price
  const today = klines[klines.length - 1]
  const todayAvg = today.amount / today.volume

  let buyPoint, sellPoint, stopLoss, logic
  if (current > cost) {
    sellPoint = Math.max(cost * 1.05, todayAvg)
    buyPoint = +(today.low * 1.005).toFixed(2)
    stopLoss = +(sellPoint * 0.97).toFixed(2)
    logic = `当前价(${current})>成本价(${cost})，高抛低吸，卖出参考价${sellPoint.toFixed(2)}`
  } else {
    buyPoint = Math.min(cost * 0.95, today.low)
    sellPoint = +(today.high * 0.995).toFixed(2)
    stopLoss = +(buyPoint * 0.97).toFixed(2)
    logic = `当前价(${current})<成本价(${cost})，逢低补仓，买入参考价${buyPoint.toFixed(2)}`
  }

  return {
    buyPoint: +buyPoint.toFixed(2), sellPoint: +sellPoint.toFixed(2), stopLoss,
    support: cost * 0.95, resistance: cost * 1.08,
    signals,
    confidence: '中',
    logic,
    riskTip: '仓位建议不超过总持仓10%，止损价' + stopLoss
  }
}

const calcStrategyC = (klines, quote) => {
  if (!klines || klines.length < 20) return null
  const signals = calcSignals(klines)
  const closes = klines.map(k => k.close)
  const ma5 = calcMA(klines, 5)
  const ma10 = calcMA(klines, 10)
  const ma20 = calcMA(klines, 20)
  const ma5v = ma5[ma5.length - 1]
  const ma10v = ma10[ma10.length - 1]
  const ma20v = ma20[ma20.length - 1]
  const current = quote.price
  const low20 = Math.min(...klines.slice(-20).map(k => k.low))
  const high10 = Math.max(...klines.slice(-10).map(k => k.high))
  const support = low20
  const resistance = high10

  let trendScore = 0
  if (ma5v > ma10v && ma10v > ma20v) trendScore = 1
  else if (ma5v < ma10v && ma10v < ma20v) trendScore = -1

  const { k, d } = calcKDJ(klines)
  const { bar } = calcMACD(klines)
  const last = klines.length - 1
  const kdjGoldCross = k[last - 1] <= d[last - 1] && k[last] > d[last]
  const macdRed = bar[last] > 0

  let momentumScore = 0
  if (kdjGoldCross) momentumScore += 0.5
  if (macdRed) momentumScore += 0.5

  const distToSupport = (current - support) / current
  const supportPressureScore = distToSupport < 0.05 ? 1 : distToSupport < 0.1 ? 0.5 : 0

  const totalScore = (trendScore * 0.3 + momentumScore * 0.3 + supportPressureScore * 0.4)
  const confidence = totalScore > 0.7 ? '高' : totalScore >= 0.4 ? '中' : '低'

  let buyPoint, sellPoint
  if (totalScore > 0.6) {
    buyPoint = +(support * 1.01).toFixed(2)
    sellPoint = +(resistance * 0.99).toFixed(2)
  } else if (totalScore > 0.3) {
    buyPoint = +(current * 0.98).toFixed(2)
    sellPoint = +(current * 1.04).toFixed(2)
  } else {
    buyPoint = +(current * 0.96).toFixed(2)
    sellPoint = +(current * 1.02).toFixed(2)
  }
  const stopLoss = +(buyPoint * 0.97).toFixed(2)

  return {
    buyPoint, sellPoint, stopLoss,
    support, resistance,
    signals,
    confidence,
    totalScore: +totalScore.toFixed(2),
    logic: `趋势(${trendScore > 0 ? '多头' : trendScore < 0 ? '空头' : '震荡'}) + 动量(${kdjGoldCross ? 'KDJ金叉+' : ''}${macdRed ? 'MACD红柱+' : ''})`,
    riskTip: '综合研判仅供参考，结合市场整体氛围决策'
  }
}

// ====== 信号展示组件 ======
const SignalsPanel = ({ signals }) => {
  if (!signals) return null

  const signalItems = [
    {
      title: '📊 MA均线',
      content: signals.ma.trend,
      badges: [
        { text: 'MA5=' + signals.ma.ma5?.toFixed(2), color: '#1890ff' },
        { text: 'MA10=' + signals.ma.ma10?.toFixed(2), color: '#1890ff' },
        { text: 'MA20=' + signals.ma.ma20?.toFixed(2), color: '#1890ff' },
      ],
      events: [
        { text: 'MA金叉', type: 'success', show: signals.ma.goldCross },
        { text: 'MA死叉', type: 'error', show: signals.ma.deathCross },
      ]
    },
    {
      title: '📈 KDJ随机指标',
      content: signals.kdj.status,
      badges: [
        { text: 'K=' + signals.kdj.k?.toFixed(1), color: signals.kdj.k > 80 ? '#f5222d' : signals.kdj.k < 20 ? '#52c41a' : '#1890ff' },
        { text: 'D=' + signals.kdj.d?.toFixed(1), color: '#1890ff' },
      ],
      events: [
        { text: 'KDJ金叉', type: 'success', show: signals.kdj.goldCross },
        { text: 'KDJ死叉', type: 'error', show: signals.kdj.deathCross },
      ]
    },
    {
      title: '📉 MACD指标',
      content: signals.macd.status,
      badges: [
        { text: 'DIF=' + signals.macd.dif?.toFixed(3), color: '#1890ff' },
        { text: 'DEA=' + signals.macd.dea?.toFixed(3), color: '#1890ff' },
      ],
      events: [
        { text: 'MACD水上金叉', type: 'success', show: signals.macd.crossUp },
        { text: 'MACD水下死叉', type: 'error', show: signals.macd.crossDown },
      ]
    }
  ]

  return (
    <Card size="small" style={{ marginTop: 12, background: '#fafafa' }} title="实时指标信号">
      <Row gutter={[12, 8]}>
        {signalItems.map(group => (
          <Col key={group.title} span={8}>
            <div className="font-medium text-sm mb-1">{group.title}</div>
            <div className="text-xs text-gray-500 mb-1">{group.content}</div>
            <div className="flex flex-wrap gap-1 mb-1">
              {group.badges.map(b => (
                <Tag key={b.text} color={b.color} style={{ margin: 0 }}>{b.text}</Tag>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {group.events.map(ev => (
                ev.show ? <Tag key={ev.text} color={ev.type} style={{ margin: 0 }}><SwapOutlined /> {ev.text}</Tag> : null
              ))}
            </div>
          </Col>
        ))}
      </Row>
    </Card>
  )
}

// ====== 做T推荐页面 ======
const TacticPage = () => {
  const { positions } = usePositionStore()
  const [tacticMode, setTacticMode] = useState('ai')
  const [selectedPos, setSelectedPos] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    if (positions.length > 0 && !selectedPos) {
      setSelectedPos(positions[0])
    }
  }, [positions])

  useEffect(() => {
    if (selectedPos) {
      runAnalysis()
    }
  }, [selectedPos, tacticMode])

  const runAnalysis = async () => {
    if (!selectedPos) return
    setAnalyzing(true)
    setAnalysisResult(null)
    try {
      const quoteRes = await quoteApi.getQuote(selectedPos.code)
      const quote = typeof quoteRes === 'object' ? quoteRes : {}
      const klineRes = await klineApi.getKline(selectedPos.code, 'd', '1')
      const klines = klineRes?.klines || []

      let result = null
      if (tacticMode === 'tech') result = calcStrategyA(klines, quote)
      else if (tacticMode === 'cost') result = calcStrategyB(klines, quote, selectedPos)
      else result = calcStrategyC(klines, quote)

      if (!result) {
        message.warning('K线数据不足，无法计算')
      } else {
        setAnalysisResult({ ...result, quote })
      }
    } catch (err) {
      message.error('分析失败: ' + err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const tacticLabel = { tech: '纯技术面', cost: '成本价锚点', ai: 'AI综合研判' }
  const pct = analysisResult?.quote?.changePct || 0

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 style={{ fontSize: 24, margin: 0 }}>做T买卖点推荐</h1>
        <Space.Compact>
          <Radio.Group value={tacticMode} onChange={e => setTacticMode(e.target.value)}>
            <Radio.Button value="tech">纯技术面</Radio.Button>
            <Radio.Button value="cost">成本价锚点</Radio.Button>
            <Radio.Button value="ai">AI综合研判</Radio.Button>
          </Radio.Group>
        </Space.Compact>
      </div>

      <Row gutter={16}>
        {/* 左侧持仓列表 */}
        <Col span={8}>
          <Card title="持仓股票" size="small" style={{ marginBottom: 16 }}>
            {positions.length === 0 ? (
              <div className="text-gray-400 text-center py-4">暂无持仓数据</div>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={4}>
                {positions.map(pos => (
                  <Card
                    key={pos.id}
                    size="small"
                    hoverable
                    onClick={() => setSelectedPos(pos)}
                    style={{
                      border: selectedPos?.id === pos.id ? '2px solid #1890ff' : '1px solid #f0f0f0',
                      cursor: 'pointer'
                    }}
                    bodyStyle={{ padding: 8 }}
                  >
                    <div className="font-medium">{pos.name || pos.code}</div>
                    <div className="text-xs text-gray-500">{pos.code}</div>
                    <div className="text-xs">成本价: ¥{pos.cost?.toFixed(2)}</div>
                    <div className="text-xs">持仓: {pos.shares}股</div>
                  </Card>
                ))}
              </Space>
            )}
          </Card>
        </Col>

        {/* 右侧分析结果 */}
        <Col span={16}>
          {analyzing ? (
            <Card style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin size="large" tip="正在分析K线数据..." />
            </Card>
          ) : analysisResult ? (
            <>
              <Card>
                <div className="flex items-center gap-2 mb-4">
                  <span className="font-bold text-lg">{selectedPos?.name} ({selectedPos?.code})</span>
                  <Tag color={pct >= 0 ? 'red' : 'green'}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</Tag>
                  <Tag>现价 ¥{analysisResult.quote?.price?.toFixed(2)}</Tag>
                  <Tag color="blue">{tacticLabel[tacticMode]}</Tag>
                </div>

                <Row gutter={16}>
                  <Col span={12}>
                    <Card size="small" headStyle={{ background: '#fff2f0', color: '#e24a4a' }} title="买入点">
                      <Statistic value={analysisResult.buyPoint} precision={2} prefix="¥" valueStyle={{ color: '#e24a4a', fontSize: 28 }} />
                      <div className="text-xs text-gray-500 mt-2">
                        建议仓位: {analysisResult.positionPct}% ({selectedPos?.shares ? Math.floor(selectedPos.shares * analysisResult.positionPct / 100) : 0}股)
                      </div>
                      <div className="text-xs text-gray-500">止损价: ¥{analysisResult.stopLoss}</div>
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small" headStyle={{ background: '#f6ffed', color: '#52c41a' }} title="卖出点">
                      <Statistic value={analysisResult.sellPoint} precision={2} prefix="¥" valueStyle={{ color: '#52c41a', fontSize: 28 }} />
                      <div className="text-xs text-gray-500 mt-2">压力位: ¥{analysisResult.resistance?.toFixed(2)}</div>
                      <div className="text-xs text-gray-500">支撑位: ¥{analysisResult.support?.toFixed(2)}</div>
                    </Card>
                  </Col>
                </Row>

                <Descriptions column={2} size="small" style={{ marginTop: 16 }}>
                  <Descriptions.Item label="置信度">
                    <Badge status={analysisResult.confidence === '高' ? 'success' : analysisResult.confidence === '中' ? 'processing' : 'default'} text={analysisResult.confidence} />
                  </Descriptions.Item>
                  {tacticMode === 'ai' && analysisResult.totalScore != null && (
                    <Descriptions.Item label="AI综合评分">
                      <span style={{ color: analysisResult.totalScore > 0.5 ? '#52c41a' : '#e24a4a' }}>{analysisResult.totalScore.toFixed(2)}</span>
                    </Descriptions.Item>
                  )}
                </Descriptions>

                <Card size="small" style={{ marginTop: 12, background: '#fafafa' }}>
                  <div className="mb-1 font-medium">核心逻辑 ({tacticLabel[tacticMode]})</div>
                  <div className="text-sm text-gray-600">{analysisResult.logic}</div>
                </Card>

                <Card size="small" style={{ marginTop: 8, background: '#fff2f0' }}>
                  <div className="mb-1 font-medium" style={{ color: '#e24a4a' }}>风险提示</div>
                  <div className="text-sm text-gray-600">{analysisResult.riskTip}</div>
                </Card>
              </Card>

              {/* 信号面板 */}
              <SignalsPanel signals={analysisResult.signals} />
            </>
          ) : (
            <Card style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="text-gray-400">点击左侧持仓股票查看做T建议</div>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  )
}

export default TacticPage
