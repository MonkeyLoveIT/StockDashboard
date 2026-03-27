import React, { useEffect, useState } from 'react'
import { Select, Card, Spin, message, Button, Segmented, Alert } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import { positionApi, klineApi } from '../services/api'

const PERIOD_OPTIONS = [
  { label: '1分钟', value: '1min' },
  { label: '5分钟', value: '5min' },
  { label: '15分钟', value: '15min' },
  { label: '30分钟', value: '30min' },
  { label: '60分钟', value: '60min' },
  { label: '日K', value: 'd' },
  { label: '周K', value: 'w' },
  { label: '月K', value: 'm' },
]

const FQ_OPTIONS = [
  { label: '不复权', value: '0' },
  { label: '前复权', value: '1' },
  { label: '后复权', value: '2' },
]

// Error boundary to prevent white screen
class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error) {
    console.error('Chart render error:', error)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
          图表渲染失败，请刷新重试
        </div>
      )
    }
    return this.props.children
  }
}

const KlineChart = () => {
  const [positions, setPositions] = useState([])
  const [selectedCode, setSelectedCode] = useState(null)
  const [klineData, setKlineData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState('d')
  const [fq, setFq] = useState('1')

  // Load positions on mount
  useEffect(() => {
    positionApi.getAll()
      .then(data => {
        setPositions(data)
        if (data.length > 0 && !selectedCode) {
          setSelectedCode(data[0].code)
        }
      })
      .catch(err => console.error('Failed to load positions:', err))
  }, [])

  // Reload kline whenever code, period, or fq changes
  useEffect(() => {
    if (!selectedCode) return

    setLoading(true)
    setKlineData(null)

    klineApi.getKline(selectedCode, period, fq)
      .then(data => {
        setKlineData(data)
        setLoading(false)
      })
      .catch(err => {
        message.error('加载K线失败: ' + err.message)
        setLoading(false)
      })
  }, [selectedCode, period, fq])

  const handleRefresh = () => {
    if (!selectedCode) return
    setLoading(true)
    setKlineData(null)
    klineApi.getKline(selectedCode, period, fq)
      .then(data => {
        setKlineData(data)
        setLoading(false)
        message.success('已刷新')
      })
      .catch(err => {
        message.error('刷新失败: ' + err.message)
        setLoading(false)
      })
  }

  // 计算均线
  const calculateMA = (data, maPeriod) => {
    if (!data || data.length === 0) return []
    return data.map((_, i) => {
      if (i < maPeriod - 1) return '-'
      const slice = data.slice(i - maPeriod + 1, i + 1)
      const avg = slice.reduce((sum, k) => sum + parseFloat(k.close || 0), 0) / maPeriod
      return avg.toFixed(2)
    })
  }

  const isMinuteKline = ['1min', '5min', '10min', '15min', '30min', '60min'].includes(period)
  const periodLabel = PERIOD_OPTIONS.find(p => p.value === period)?.label || 'K线'
  const fqLabel = FQ_OPTIONS.find(f => f.value === fq)?.label || ''

  const buildOption = () => {
    if (!klineData?.klines?.length) return {}

    const klines = klineData.klines
    const dates = klines.map(k => k.date)
    const ma5 = calculateMA(klines, 5)
    const ma10 = calculateMA(klines, 10)
    const ma20 = calculateMA(klines, 20)
    const ma60 = calculateMA(klines, 60)

    const base = {
      title: {
        text: `${klineData.name || ''} (${klineData.code}) ${periodLabel}${fqLabel ? ' ' + fqLabel : ''}`,
        left: 'center'
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: {
        data: isMinuteKline ? ['K线', '成交量'] : ['K线', 'MA5', 'MA10', 'MA20', 'MA60'],
        top: 30
      },
      xAxis: { type: 'category', data: dates, boundaryGap: false, axisLine: { lineStyle: { color: '#999' } } },
      yAxis: { type: 'value', scale: true, splitArea: { show: true } },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { type: 'slider', start: 0, end: 100 }
      ],
      series: [
        {
          name: 'K线', type: 'candlestick',
          data: klines.map(k => [k.open, k.close, k.low, k.high]),
          itemStyle: { color: '#ec0000', color0: '#00a870', borderColor: '#ec0000', borderColor0: '#00a870' }
        },
        { name: 'MA5', type: 'line', data: ma5, smooth: true, lineStyle: { width: 1 }, symbol: 'none' },
        { name: 'MA10', type: 'line', data: ma10, smooth: true, lineStyle: { width: 1 }, symbol: 'none' },
        { name: 'MA20', type: 'line', data: ma20, smooth: true, lineStyle: { width: 1 }, symbol: 'none' },
        { name: 'MA60', type: 'line', data: ma60, smooth: true, lineStyle: { width: 1 }, symbol: 'none' }
      ]
    }

    if (isMinuteKline) {
      return {
        ...base,
        grid: [
          { left: '10%', right: '10%', top: '15%', height: '55%' },
          { left: '10%', right: '10%', top: '72%', height: '18%' }
        ],
        xAxis: [
          { ...base.xAxis, gridIndex: 0 },
          { ...base.xAxis, gridIndex: 1 }
        ],
        yAxis: [
          { type: 'value', gridIndex: 0, scale: true, splitArea: { show: true }, axisLine: { show: false } },
          { type: 'value', gridIndex: 1, scale: true, axisLine: { show: false }, splitLine: { show: false } }
        ],
        series: [
          { ...base.series[0], xAxisIndex: 0, yAxisIndex: 0 },
          ...base.series.slice(1, 5).map(s => ({ ...s, xAxisIndex: 0, yAxisIndex: 0 })),
          {
            name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1,
            data: klines.map(k => ({
              value: k.volume,
              itemStyle: { color: k.close >= k.open ? '#ec0000' : '#00a870' }
            }))
          }
        ]
      }
    }

    return { ...base, grid: { left: '10%', right: '10%', top: '20%', bottom: '15%' } }
  }

  // Check if minute data only covers today (data range too narrow)
  const minuteDataNotice = (() => {
    if (!isMinuteKline || !klineData?.klines?.length) return null
    const dates = klineData.klines.map(k => k.date.split(' ')[0])
    const uniqueDays = [...new Set(dates)]
    if (uniqueDays.length <= 1) {
      return (
        <Alert
          type="warning"
          message={`分钟K线仅包含今日（${uniqueDays[0]}）数据，无法查看历史分钟走势。如需查看历史走势，请切换至日K/周K/月K。`}
          style={{ marginBottom: 12 }}
          showIcon
        />
      )
    }
    return null
  })()

  const selectOptions = positions.map(p => ({
    value: p.code,
    label: `${p.code} ${p.name || ''}`
  }))

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>K线图</h1>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <span>选择股票:</span>
          <Select
            value={selectedCode}
            onChange={val => setSelectedCode(val)}
            placeholder="选择持仓股票"
            style={{ width: 200 }}
            options={selectOptions}
            loading={positions.length === 0}
          />

          <span style={{ marginLeft: 8 }}>K线周期:</span>
          <Segmented
            value={period}
            onChange={val => setPeriod(val)}
            options={PERIOD_OPTIONS}
          />

          <span style={{ marginLeft: 8 }}>复权:</span>
          <Segmented
            value={fq}
            onChange={val => setFq(val)}
            options={FQ_OPTIONS}
            size="small"
          />

          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
            size="small"
            style={{ marginLeft: 'auto' }}
          >
            刷新
          </Button>
        </div>
      </Card>

      <Card>
        {minuteDataNotice}

        {loading ? (
          <div className="flex justify-center items-center" style={{ height: 600 }}>
            <Spin size="large" />
          </div>
        ) : klineData?.klines?.length ? (
          <ChartErrorBoundary>
            <ReactECharts
              option={buildOption()}
              style={{ height: isMinuteKline ? 700 : 600 }}
              opts={{ renderer: 'canvas' }}
            />
          </ChartErrorBoundary>
        ) : (
          <div className="text-center text-gray-400 py-8">
            暂无K线数据
          </div>
        )}
      </Card>
    </div>
  )
}

export default KlineChart
