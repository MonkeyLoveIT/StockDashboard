import React, { useState } from 'react'
import { Radio, Card, Spin, Tag, Space, Row, Col, Statistic, message, InputNumber, Button, Descriptions, Badge } from 'antd'
import { screenerApi } from '../services/api'

const getPriceColor = (pct) => {
  if (pct > 0) return '#e24a4a'
  if (pct < 0) return '#52c41a'
  return '#999'
}

const riskBadge = (level) => {
  const map = { '低': 'success', '中': 'processing', '高': 'error' }
  return <Badge status={map[level] || 'default'} text={level} />
}

const strategyBadge = (s) => {
  const map = { '短线': 'red', '中线': 'blue', '长线': 'green' }
  return <Tag color={map[s] || 'default'}>{s}</Tag>
}

const RecommendPage = () => {
  const [strategyMode, setStrategyMode] = useState('combined')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [hasSearched, setHasSearched] = useState(false)

  const [filters, setFilters] = useState({
    minPct: 3,
    minVolRatio: 1.5,
    minTurnover: 2,
    maxPE: 15,
    maxPB: 2,
    minProfitGrowth: 0
  })

  const strategyLabel = { short: '短线技术选股', value: '低估价值筛选', combined: 'A+B综合' }

  const handleSearch = async () => {
    setLoading(true)
    setHasSearched(true)
    try {
      let res
      if (strategyMode === 'short') {
        res = await screenerApi.short({
          minPct: filters.minPct,
          minVolRatio: filters.minVolRatio,
          minTurnover: filters.minTurnover
        })
      } else if (strategyMode === 'value') {
        res = await screenerApi.value({
          maxPE: filters.maxPE,
          maxPB: filters.maxPB,
          minProfitGrowth: filters.minProfitGrowth
        })
      } else {
        res = await screenerApi.combined(filters)
      }
      setResults(res.results || [])
      setTotal(res.total || 0)
    } catch (err) {
      message.error('筛选失败: ' + err.message)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const updateFilter = (key, val) => {
    setFilters(prev => ({ ...prev, [key]: val }))
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>股票推荐</h1>
        <Space.Compact>
          <Radio.Group value={strategyMode} onChange={e => setStrategyMode(e.target.value)}>
            <Radio.Button value="short">短线技术选股</Radio.Button>
            <Radio.Button value="value">低估价值筛选</Radio.Button>
            <Radio.Button value="combined">A+B综合</Radio.Button>
          </Radio.Group>
        </Space.Compact>
      </div>

      {/* 筛选参数区 */}
      <Card title="筛选参数" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          {(strategyMode === 'short' || strategyMode === 'combined') && (
            <>
              <Col span={6}>
                <div className="mb-2 text-sm text-gray-500">最小涨幅 %</div>
                <InputNumber
                  min={0} max={20} step={0.5}
                  value={filters.minPct}
                  onChange={v => updateFilter('minPct', v)}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={6}>
                <div className="mb-2 text-sm text-gray-500">最小量比</div>
                <InputNumber
                  min={0.5} max={10} step={0.1}
                  value={filters.minVolRatio}
                  onChange={v => updateFilter('minVolRatio', v)}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={6}>
                <div className="mb-2 text-sm text-gray-500">最小换手率 %</div>
                <InputNumber
                  min={0} max={50} step={0.5}
                  value={filters.minTurnover}
                  onChange={v => updateFilter('minTurnover', v)}
                  style={{ width: '100%' }}
                />
              </Col>
            </>
          )}
          {(strategyMode === 'value' || strategyMode === 'combined') && (
            <>
              <Col span={6}>
                <div className="mb-2 text-sm text-gray-500">最大PE</div>
                <InputNumber
                  min={1} max={100}
                  value={filters.maxPE}
                  onChange={v => updateFilter('maxPE', v)}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={6}>
                <div className="mb-2 text-sm text-gray-500">最大PB</div>
                <InputNumber
                  min={0.1} max={20} step={0.1}
                  value={filters.maxPB}
                  onChange={v => updateFilter('maxPB', v)}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={6}>
                <div className="mb-2 text-sm text-gray-500">最小净利润增速 %</div>
                <InputNumber
                  min={-100} max={500}
                  value={filters.minProfitGrowth}
                  onChange={v => updateFilter('minProfitGrowth', v)}
                  style={{ width: '100%' }}
                />
              </Col>
            </>
          )}
          <Col span={6} style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button type="primary" onClick={handleSearch} loading={loading}>
              开始筛选
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 结果区 */}
      {loading ? (
        <Card style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" tip="正在筛选股票..." />
        </Card>
      ) : hasSearched ? (
        <>
          <div className="mb-3 text-sm text-gray-500">
            共筛选出 {total} 只股票，显示TOP {results.length} 只
          </div>
          {results.length === 0 ? (
            <Card>
              <div className="text-center text-gray-400 py-8">未找到符合条件的股票</div>
            </Card>
          ) : (
            <Row gutter={[12, 12]}>
              {results.map((stock, idx) => {
                const pct = stock.changePct || 0
                const priceColor = getPriceColor(pct)
                return (
                  <Col span={12} key={stock.code}>
                    <Card size="small" hoverable>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="font-medium text-base">{stock.name}</span>
                          <span className="text-gray-400 ml-2">{stock.code}</span>
                        </div>
                        <Space>
                          {strategyBadge(stock.suitableStrategy)}
                          {riskBadge(stock.riskLevel)}
                        </Space>
                      </div>
                      <Descriptions column={3} size="small">
                        <Descriptions.Item label="现价">
                          <span style={{ color: priceColor, fontWeight: 'bold' }}>
                            ¥{stock.price?.toFixed(2) || '-'}
                          </span>
                        </Descriptions.Item>
                        <Descriptions.Item label="涨跌幅">
                          <span style={{ color: priceColor }}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                          </span>
                        </Descriptions.Item>
                        <Descriptions.Item label="量比">
                          {stock.volRatio || '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="换手率">
                          {stock.turnover !== '-' ? `${stock.turnover}%` : '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="PE">
                          {stock.pe && stock.pe !== '-' ? stock.pe : '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="PB">
                          {stock.pb && stock.pb !== '-' ? stock.pb : '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="净利润增速" span={3}>
                          {stock.profitGrowth && stock.profitGrowth !== '-' ? `${stock.profitGrowth}%` : '-'}
                        </Descriptions.Item>
                      </Descriptions>
                      <Card size="small" bodyStyle={{ padding: 8 }} style={{ marginTop: 8, background: '#fafafa' }}>
                        <div className="text-xs text-gray-600">
                          <span className="font-medium">推荐理由: </span>{stock.reason}
                        </div>
                      </Card>
                    </Card>
                  </Col>
                )
              })}
            </Row>
          )}
        </>
      ) : (
        <Card style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="text-gray-400">配置筛选参数后点击"开始筛选"</div>
        </Card>
      )}
    </div>
  )
}

export default RecommendPage
