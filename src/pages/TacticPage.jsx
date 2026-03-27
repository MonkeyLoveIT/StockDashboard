import React, { useEffect, useState } from 'react'
import { Radio, Card, Spin, Tag, Space, Row, Col, Statistic, message, Descriptions, Badge } from 'antd'
import { positionApi, klineApi, quoteApi } from '../services/api'
import usePositionStore from '../stores/useStore'

// 涨红跌绿颜色
const getPriceColor = (pct) => {
  if (pct > 0) return '#e24a4a'
  if (pct < 0) return '#52c41a'
  return '#999'
}

// 计算均线
const calcMA = (klines, period) => {
  const result = []
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sum = 0
    for (let j = 0; j < period; j++) sum += klines[i - j].close
    result.push(sum / period)
  }
  return result
}

// 计算KDJ
const calcKDJ = (klines, period = 9) => {
  const k = [], d = [], j = []
  const rsv = []
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) { rsv.push(null); k.push(null); d.push(null); j.push(null); continue }
    const high = Math.max(...klines.slice(i - period + 1, i + 1).map(k => k.high))
    const low = Math.min(...klines.slice(i - period + 1, i + 1).map(k => k.low))
    const close = klines[i].close
    const rsvVal = high === low ? 50 : (close - low) / (high - low) * 100
    rsv.push(rsvVal)
    const prevK = k[i - 1] || 50
    const prevD = d[i - 1] || 50
    k.push(prevK * 2 / 3 + rsvVal / 3)
    d.push(prevD * 2 / 3 + k[i] / 3)
    j.push(k[i] * 3 - d[i] * 2)
  }
  return { k, d, j }
}

// 计算MACD
const calcMACD = (klines, fast = 12, slow = 26, signal = 9) => {
  const ema = (arr, period) => {
    const result = []
    const k = 2 / (period + 1)
    for (let i = 0; i < arr.length; i++) {
      if (i === 0) { result.push(arr[i]); continue }
      result.push(arr[i] * k + result[i - 1] * (1 - k))
    }
    return result
  }
  const closes = klines.map(k => k.close)
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const dif = emaFast.map((v, i) => v - emaSlow[i])
  const dea = ema(dif, signal)
  const bar = dif.map((v, i) => (v - dea[i]) * 2)
  return { dif, dea, bar }
}

// 策略A：纯技术面
const calcStrategyA = (klines, quote) => {
  if (!klines || klines.length < 20) return null
  const recent20 = klines.slice(-20)
  const recent10 = klines.slice(-10)
  const low20 = Math.min(...recent20.map(k => k.low))
  const high10 = Math.max(...recent10.map(k => k.high))
  const ma5 = calcMA(klines, 5)
  const ma10 = calcMA(klines, 10)
  const ma5Val = ma5[ma5.length - 1]
  const ma10Val = ma10[ma10.length - 1]
  const support = Math.min(low20, ma5Val)
  const resistance = Math.max(high10, ma10Val)
  const current = quote.price
  const buyPoint = +(support * 1.01).toFixed(2)
  const sellPoint = +(resistance * 0.99).toFixed(2)
  const stopLoss = +(support * 0.97).toFixed(2)
  const positionPct = Math.min(30, Math.max(10, Math.round((support * 100) / current)))
  return {
    buyPoint, sellPoint, stopLoss, positionPct,
    support, resistance,
    confidence: klines.length > 60 ? '高' : klines.length > 30 ? '中' : '低',
    logic: `支撑位=${support.toFixed(2)}(近20日低+MA5) 压力位=${resistance.toFixed(2)}(近10日高+MA10)`,
    riskTip: '注意突破有效性，量能配合是关键'
  }
}

// 策略B：成本价锚点
const calcStrategyB = (klines, quote, position) => {
  if (!klines || klines.length < 5) return null
  const cost = position.cost
  const current = quote.price
  const today = klines[klines.length - 1]
  const todayAvg = (today.amount / today.volume)
  const todayLow = today.low
  const todayHigh = today.high
  let buyPoint, sellPoint, stopLoss, logic, direction
  if (current > cost) {
    // 做T卖出点
    sellPoint = Math.max(cost * 1.05, todayAvg)
    buyPoint = +(todayLow * 1.005).toFixed(2)
    stopLoss = +(sellPoint * 0.97).toFixed(2)
    logic = `当前价(${current})>成本价(${cost})，适合高抛低吸，卖出点参考今日均价${todayAvg.toFixed(2)}`
    direction = '高抛'
  } else {
    // 做T买入点
    buyPoint = Math.min(cost * 0.95, todayLow)
    sellPoint = +(todayHigh * 0.995).toFixed(2)
    stopLoss = +(buyPoint * 0.97).toFixed(2)
    logic = `当前价(${current})<成本价(${cost})，适合逢低补仓，买入点参考成本价下方${(cost * 0.95).toFixed(2)}`
    direction = '低吸'
  }
  const positionPct = Math.min(30, Math.max(10, Math.round(position.shares * 0.1)))
  return {
    buyPoint: +buyPoint.toFixed(2), sellPoint: +sellPoint.toFixed(2),
    stopLoss, positionPct,
    support: cost * 0.95, resistance: cost * 1.08,
    confidence: '中',
    logic,
    riskTip: `仓位建议不超过总持仓10%，止损价${stopLoss}`
  }
}

// 策略C：AI综合研判
const calcStrategyC = (klines, quote) => {
  if (!klines || klines.length < 20) return null
  const closes = klines.map(k => k.close)
  const volumes = klines.map(k => k.volume)
  const ma5 = calcMA(klines, 5)
  const ma10 = calcMA(klines, 10)
  const ma20 = calcMA(klines, 20)
  const ma5v = ma5[ma5.length - 1]
  const ma10v = ma10[ma10.length - 1]
  const ma20v = ma20[ma20.length - 1]
  const current = quote.price
  const recent10 = klines.slice(-10)
  const low20 = Math.min(...klines.slice(-20).map(k => k.low))
  const high10 = Math.max(...recent10.map(k => k.high))
  const support = low20
  const resistance = high10

  // 趋势得分
  let trendScore = 0
  if (ma5v > ma10v && ma10v > ma20v) trendScore = 1
  else if (ma5v < ma10v && ma10v < ma20v) trendScore = -1
  else trendScore = 0

  // 动量得分
  const kdj = calcKDJ(klines)
  const macd = calcMACD(klines)
  const kdjGoldCross = kdj.k[kdj.k.length - 1] > kdj.d[kdj.d.length - 1] && kdj.k[kdj.k.length - 2] <= kdj.d[kdj.d.length - 2]
  const macdRed = macd.bar[macd.bar.length - 1] > 0
  let momentumScore = 0
  if (kdjGoldCross) momentumScore += 0.5
  if (macdRed) momentumScore += 0.5

  // 支撑压力得分
  const distToSupport = (current - support) / current
  const distToResistance = (resistance - current) / current
  const supportPressureScore = distToSupport < 0.05 ? 1 : distToSupport < 0.1 ? 0.5 : 0

  // 综合评分
  const totalScore = (trendScore * 0.3 + momentumScore * 0.3 + supportPressureScore * 0.4)
  const confidence = totalScore > 0.7 ? '高' : totalScore >= 0.4 ? '中' : '低'

  // 映射买卖点
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
  const positionPct = Math.min(30, Math.max(5, Math.round(totalScore * 40)))

  return {
    buyPoint, sellPoint, stopLoss, positionPct,
    support, resistance,
    confidence,
    logic: `趋势(${trendScore > 0 ? '多头' : trendScore < 0 ? '空头' : '震荡'}) + 动量(${kdjGoldCross ? 'KDJ金叉+' : ''}${macdRed ? 'MACD红柱+' : ''}) + 距支撑压力位距离(${distToSupport.toFixed(2)}, ${distToResistance.toFixed(2)})`,
    riskTip: '综合研判仅供参考，结合市场整体氛围决策',
    totalScore: +totalScore.toFixed(2)
  }
}

const TacticPage = () => {
  const { positions } = usePositionStore()
  const [loading, setLoading] = useState(false)
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
    try {
      const quote = await quoteApi.getQuote(selectedPos.code)
      const klineRes = await klineApi.getKline(selectedPos.code, 'd')
      const klines = klineRes?.klines || []

      let result = null
      if (tacticMode === 'tech') result = calcStrategyA(klines, quote)
      else if (tacticMode === 'cost') result = calcStrategyB(klines, quote, selectedPos)
      else result = calcStrategyC(klines, quote)

      if (!result) {
        message.warning('K线数据不足，无法计算')
        setAnalysisResult(null)
      } else {
        setAnalysisResult({ ...result, quote, klines })
      }
    } catch (err) {
      message.error('分析失败: ' + err.message)
      setAnalysisResult(null)
    } finally {
      setAnalyzing(false)
    }
  }

  const tacticLabel = { tech: '纯技术面', cost: '成本价锚点', ai: 'AI综合研判' }
  const pct = analysisResult?.quote?.changePct || 0
  const priceColor = getPriceColor(pct)

  return (
    <div>
      <div className="flex justify-between items-center mb-6" style={{ marginBottom: 24 }}>
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
        {/* 左侧：持仓列表 */}
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

        {/* 右侧：分析结果 */}
        <Col span={16}>
          {analyzing ? (
            <Card style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin size="large" tip="正在分析K线数据..." />
            </Card>
          ) : analysisResult ? (
            <Card title={
              <Space>
                <span>{selectedPos?.name} ({selectedPos?.code})</span>
                <Tag color={pct >= 0 ? 'red' : 'green'}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</Tag>
                <Tag>现价 ¥{analysisResult.quote?.price?.toFixed(2)}</Tag>
                <Tag color="blue">{tacticLabel[tacticMode]}</Tag>
              </Space>
            }>
              <Row gutter={16}>
                <Col span={12}>
                  <Card size="small" headStyle={{ background: '#fff2f0', color: '#e24a4a' }} title="买入点">
                    <Statistic
                      value={analysisResult.buyPoint}
                      precision={2}
                      prefix="¥"
                      valueStyle={{ color: '#e24a4a', fontSize: 28 }}
                    />
                    <div className="text-xs text-gray-500 mt-2">
                      建议仓位: {analysisResult.positionPct}% ({selectedPos?.shares ? Math.floor(selectedPos.shares * analysisResult.positionPct / 100) : 0}股)
                    </div>
                    <div className="text-xs text-gray-500">止损价: ¥{analysisResult.stopLoss}</div>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small" headStyle={{ background: '#f6ffed', color: '#52c41a' }} title="卖出点">
                    <Statistic
                      value={analysisResult.sellPoint}
                      precision={2}
                      prefix="¥"
                      valueStyle={{ color: '#52c41a', fontSize: 28 }}
                    />
                    <div className="text-xs text-gray-500 mt-2">
                      压力位: ¥{analysisResult.resistance?.toFixed(2)}
                    </div>
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
                    <span style={{ color: analysisResult.totalScore > 0.5 ? '#52c41a' : '#e24a4a' }}>
                      {analysisResult.totalScore.toFixed(2)}
                    </span>
                  </Descriptions.Item>
                )}
              </Descriptions>

              <Card size="small" style={{ marginTop: 16, background: '#fafafa' }}>
                <div className="mb-2 font-medium">核心逻辑 ({tacticLabel[tacticMode]})</div>
                <div className="text-sm text-gray-600">{analysisResult.logic}</div>
              </Card>

              <Card size="small" style={{ marginTop: 8, background: '#fff2f0' }}>
                <div className="mb-2 font-medium" style={{ color: '#e24a4a' }}>风险提示</div>
                <div className="text-sm text-gray-600">{analysisResult.riskTip}</div>
              </Card>
            </Card>
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
