import React, { useEffect, useState } from 'react'
import {
  Table, Button, Card, Row, Col, Statistic, Collapse, Switch, InputNumber,
  message, Space, Tag, Popconfirm, Empty, Spin, Descriptions
} from 'antd'
import {
  ReloadOutlined, DeleteOutlined, InfoCircleOutlined,
  ThunderboltOutlined, ExperimentOutlined
} from '@ant-design/icons'
import { paperApi } from '../services/api'

const { Panel } = Collapse

// ---- Helpers ----
const fmtMoney = (v) => {
  if (v === null || v === undefined) return '-'
  return `¥${Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const fmtPct = (v) => {
  if (v === null || v === undefined) return '-'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}
const fmtShares = (v) => v ? `${v.toLocaleString()}股` : '-'
const fmtPrice = (v) => v ? `¥${v.toFixed(2)}` : '-'

const profitColor = (v) => {
  if (v === null || v === undefined || v === 0) return '#9ca3af'
  return v > 0 ? '#ef4444' : '#22c55e'
}

const TYPE_COLORS = {
  buy: 'green',
  sell: 'blue',
  stop_loss: 'red',
  take_profit: 'gold',
}
const TYPE_LABELS = {
  buy: '买入',
  sell: '卖出',
  stop_loss: '止损',
  take_profit: '止盈',
}

// ============================================================
// Strategy switches config
// ============================================================
const STRATEGIES = [
  { key: 'strategy_oversold', label: '底部反弹', desc: '超跌反弹策略' },
  { key: 'strategy_uptrend', label: '趋势上涨', desc: '趋势顺势策略' },
  { key: 'strategy_hot', label: '热门资金', desc: '热门题材策略' },
  { key: 'strategy_breakthrough', label: '突破拉升', desc: '突破买入策略' },
  { key: 'strategy_longvalue', label: '长线价值', desc: '价值投资策略' },
]

const NUMERIC_FIELDS = [
  { key: 'initial_cash', label: '初始资金（元）', min: 10000, max: 100000000, step: 10000 },
  { key: 'max_position_pct', label: '单股仓位上限（%）', min: 1, max: 100, step: 1 },
  { key: 'stop_loss_pct', label: '止损比例（%，负数）', min: -50, max: -1, step: 0.5 },
  { key: 'take_profit_pct', label: '止盈比例（%，正数）', min: 1, max: 100, step: 1 },
  { key: 'max_positions', label: '最大持仓数', min: 1, max: 20, step: 1 },
  { key: 'buy_ratio', label: '每次买入比例（%）', min: 1, max: 100, step: 5 },
]

// ============================================================
// Main Component
// ============================================================
export default function PaperTrading() {
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState({})
  const [summary, setSummary] = useState(null)
  const [positions, setPositions] = useState([])
  const [orders, setOrders] = useState([])
  const [ordersTotal, setOrdersTotal] = useState(0)
  const [ordersPage, setOrdersPage] = useState(1)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const loadAll = async () => {
    setLoading(true)
    try {
      const [cfg, sum, pos, ord] = await Promise.all([
        paperApi.getConfig(),
        paperApi.getSummary(),
        paperApi.getPositions(),
        paperApi.getOrders(1, 20),
      ])
      setConfig(cfg)
      setSummary(sum)
      setPositions(pos)
      setOrders(ord.orders || [])
      setOrdersTotal(ord.total || 0)
      setOrdersPage(1)
    } catch (e) {
      message.error('加载失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const handleSaveConfig = async () => {
    setSaving(true)
    try {
      await paperApi.updateConfig(config)
      message.success('配置已保存')
    } catch (e) {
      message.error('保存失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      await paperApi.reset()
      message.success('账户已重置')
      await loadAll()
    } catch (e) {
      message.error('重置失败: ' + e.message)
    } finally {
      setResetting(false)
    }
  }

  const handlePageChange = async (page) => {
    setOrdersPage(page)
    const ord = await paperApi.getOrders(page, 20)
    setOrders(ord.orders || [])
    setOrdersTotal(ord.total || 0)
  }

  const totalAssets = summary ? summary.currentCash + summary.totalMarketValue : 0

  // ---- Positions Table columns ----
  const posColumns = [
    {
      title: '股票',
      dataIndex: 'code',
      key: 'code',
      render: (code, row) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{row.name || code}</span>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>{code}</span>
        </Space>
      ),
    },
    {
      title: '持仓',
      dataIndex: 'shares',
      key: 'shares',
      render: fmtShares,
    },
    {
      title: '成本价',
      dataIndex: 'cost',
      key: 'cost',
      render: fmtPrice,
    },
    {
      title: '当前价',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      render: fmtPrice,
    },
    {
      title: '止损价',
      dataIndex: 'stopLossPrice',
      key: 'stopLossPrice',
      render: v => v ? `¥${v.toFixed(2)}` : '-',
    },
    {
      title: '止盈价',
      dataIndex: 'takeProfitPrice',
      key: 'takeProfitPrice',
      render: v => v ? `¥${v.toFixed(2)}` : '-',
    },
    {
      title: '盈亏（额/率）',
      key: 'profit',
      render: (_, row) => (
        <span style={{ color: profitColor(row.profit) }}>
          {fmtMoney(row.profit)}<br />
          <span style={{ fontSize: 12 }}>{fmtPct(row.profitPct)}</span>
        </span>
      ),
    },
    {
      title: '策略',
      dataIndex: 'strategy',
      key: 'strategy',
      render: v => v ? <Tag color="blue">{v}</Tag> : '-',
    },
    {
      title: '建仓时间',
      dataIndex: 'buyDate',
      key: 'buyDate',
      render: v => v ? v.slice(0, 16).replace('T', ' ') : '-',
    },
  ]

  // ---- Orders Table columns ----
  const orderColumns = [
    {
      title: '时间',
      dataIndex: 'order_at',
      key: 'order_at',
      width: 160,
      render: v => v ? v.slice(0, 16).replace('T', ' ') : '-',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: type => (
        <Tag color={TYPE_COLORS[type] || 'default'}>{TYPE_LABELS[type] || type}</Tag>
      ),
    },
    {
      title: '股票',
      key: 'stock',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.name || row.code}</span>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>{row.code}</span>
        </Space>
      ),
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      render: fmtPrice,
    },
    {
      title: '数量',
      dataIndex: 'shares',
      key: 'shares',
      render: fmtShares,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: fmtMoney,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      render: v => v || '-',
    },
    {
      title: '策略',
      dataIndex: 'strategy',
      key: 'strategy',
      render: v => v ? <Tag color="purple">{v}</Tag> : '-',
    },
    {
      title: '评分',
      dataIndex: 'signal_score',
      key: 'signal_score',
      render: v => v || '-',
    },
  ]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>📊 模拟实盘</h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>刷新</Button>
          <Popconfirm
            title="确定重置模拟账户？"
            description="将清空所有成交记录，资金恢复初始值"
            onConfirm={handleReset}
            okText="确定重置"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: resetting }}
          >
            <Button danger>重置账户</Button>
          </Popconfirm>
        </Space>
      </div>

      <Spin spinning={loading}>

        {/* Account Summary */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="当前总资产"
                value={totalAssets}
                precision={2}
                prefix="¥"
                valueStyle={{ color: '#3b82f6' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="总盈亏（额/率）"
                value={summary?.totalProfit || 0}
                precision={2}
                prefix={summary?.totalProfit >= 0 ? '+' : ''}
                suffix={`(${fmtPct(summary?.totalProfitPct)})`}
                valueStyle={{ color: profitColor(summary?.totalProfit) }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="持仓胜率"
                value={summary?.winRate || 0}
                precision={1}
                suffix="%"
                prefix={`${summary?.winCount || 0}胜/${summary?.loseCount || 0}负`}
                valueStyle={{ color: '#f59e0b' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="持仓数量"
                value={summary?.positionsCount || 0}
                suffix={`/ ${config.max_positions || 8}只`}
                valueStyle={{ color: '#8b5cf6' }}
              />
            </Card>
          </Col>
        </Row>

        {/* Risk Config */}
        <Collapse style={{ marginBottom: 24 }} defaultActiveKey={[]}>
          <Panel
            header={<Space><InfoCircleOutlined />风控参数配置</Space>}
            key="config"
          >
            <Row gutter={[16, 12]}>
              {NUMERIC_FIELDS.map(field => (
                <Col span={8} key={field.key}>
                  <Space align="start" style={{ width: '100%' }}>
                    <span style={{ width: 180, fontSize: 13 }}>{field.label}:</span>
                    <InputNumber
                      value={parseFloat(config[field.key]) || 0}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      onChange={v => setConfig(prev => ({ ...prev, [field.key]: String(v) }))}
                      style={{ width: 120 }}
                    />
                  </Space>
                </Col>
              ))}
            </Row>

            <div style={{ marginTop: 16, marginBottom: 8, fontSize: 13 }}>策略开关:</div>
            <Row gutter={[16, 8]}>
              {STRATEGIES.map(s => (
                <Col span={8} key={s.key}>
                  <Space>
                    <Switch
                      checked={config[s.key] === '1'}
                      onChange={v => setConfig(prev => ({ ...prev, [s.key]: v ? '1' : '0' }))}
                      size="small"
                    />
                    <span style={{ fontSize: 13 }}>{s.label}</span>
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>— {s.desc}</span>
                  </Space>
                </Col>
              ))}
            </Row>

            <div style={{ marginTop: 16 }}>
              <Button type="primary" onClick={handleSaveConfig} loading={saving}>
                保存配置
              </Button>
              <span style={{ marginLeft: 16, color: '#9ca3af', fontSize: 12 }}>
                可用资金: {fmtMoney(summary?.currentCash)} | 初始资金: {fmtMoney(summary?.initialCash)}
              </span>
            </div>
          </Panel>
        </Collapse>

        {/* Current Positions */}
        <Card
          title={<Space><ThunderboltOutlined />当前虚拟持仓</Space>}
          style={{ marginBottom: 24 }}
          extra={<span style={{ color: '#9ca3af' }}>共 {positions.length} 只</span>}
        >
          {positions.length === 0 ? (
            <Empty description="暂无持仓" />
          ) : (
            <Table
              dataSource={positions}
              columns={posColumns}
              rowKey="code"
              pagination={false}
              size="small"
            />
          )}
        </Card>

        {/* Orders Record */}
        <Card
          title={<Space><ExperimentOutlined />成交记录</Space>}
          extra={
            <span style={{ color: '#9ca3af' }}>
              共 {ordersTotal} 条，第 {ordersPage} 页
            </span>
          }
        >
          <Table
            dataSource={orders}
            columns={orderColumns}
            rowKey="id"
            size="small"
            pagination={{
              current: ordersPage,
              pageSize: 20,
              total: ordersTotal,
              onChange: handlePageChange,
              showSizeChanger: false,
            }}
          />
        </Card>

        {/* Disclaimer */}
        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 24, marginBottom: 8 }}>
          ⚠️ 模拟实盘仅供策略验证，不构成投资建议。历史表现不代表未来收益。
        </div>

      </Spin>
    </div>
  )
}
