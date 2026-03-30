import React, { useEffect, useState } from 'react'
import {
  Table, Button, Modal, Form, Input, InputNumber, Popconfirm, message,
  Space, Tag, Tooltip, AutoComplete, Card, Row, Col, Statistic,
  Collapse, Select, DatePicker, Empty
} from 'antd'
import {
  ReloadOutlined, PlusOutlined, MinusOutlined, HistoryOutlined,
  DeleteOutlined, EyeOutlined, EyeInvisibleOutlined, StarOutlined,
  StarFilled, DownOutlined, UpOutlined
} from '@ant-design/icons'
import { positionApi, quoteApi, searchApi } from '../services/api'
import usePositionStore from '../stores/useStore'

const { Panel } = Collapse

// ---- 颜色辅助 ----
const profitColor = (v) => v > 0 ? '#ef4444' : v < 0 ? '#22c55e' : '#9ca3af'
const profitSign = (v) => v > 0 ? '+' : ''

const formatMoney = (v) => {
  if (v === null || v === undefined) return '-'
  return `¥${Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const formatPct = (v) => {
  if (v === null || v === undefined) return '-'
  return `${profitSign(v)}${v.toFixed(2)}%`
}

const formatShares = (v) => {
  if (!v) return '-'
  return v.toLocaleString() + '股'
}

// ============================================================
// 持仓概览卡片
// ============================================================
const OverviewCard = ({ positions, masked }) => {
  const totalAmount = positions.reduce((sum, p) => sum + (p.currentAmount || 0), 0)
  const totalProfit = positions.reduce((sum, p) => sum + (p.profit || 0), 0)
  const totalCostAmount = positions.reduce((sum, p) => sum + (p.costAmount || 0), 0)
  const totalProfitPct = totalCostAmount > 0 ? (totalProfit / totalCostAmount) * 100 : 0
  const todayProfit = positions.reduce((sum, p) => sum + (p.todayProfit || 0), 0)
  const todayProfitPct = positions.reduce((sum, p) => {
    const prev = p.prevClose || p.currentPrice
    const base = prev * p.shares
    return sum + (base > 0 ? ((p.currentPrice - prev) / prev) * 100 * (p.currentAmount / base) : 0)
  }, 0)

  const cards = [
    {
      label: '总持仓市值',
      value: masked ? '******' : formatMoney(totalAmount),
      color: '#374151'
    },
    {
      label: '持仓盈亏',
      value: masked ? '******' : formatMoney(totalProfit),
      sub: masked ? null : formatPct(totalProfitPct),
      color: profitColor(totalProfit),
      sign: totalProfit >= 0 ? '+' : '-'
    },
    {
      label: '当日盈亏',
      value: masked ? '******' : formatMoney(todayProfit),
      sub: masked ? null : formatPct(todayProfitPct),
      color: profitColor(todayProfit),
      sign: todayProfit >= 0 ? '+' : '-'
    },
    {
      label: '持仓股票数',
      value: positions.length,
      color: '#374151'
    }
  ]

  return (
    <Row gutter={16} style={{ marginBottom: 16 }}>
      {cards.map((c, i) => (
        <Col xs={24} sm={12} md={6} key={i}>
          <Card size="small" bordered={false} style={{ background: '#1f2937', borderRadius: 8 }}>
            <Statistic
              title={<span style={{ color: '#9ca3af', fontSize: 13 }}>{c.label}</span>}
              value={c.value}
              suffix={c.sub ? <span style={{ color: c.color, fontSize: 13 }}>{c.sub}</span> : null}
              valueStyle={{ color: c.color, fontSize: 22, fontWeight: 600 }}
            />
          </Card>
        </Col>
      ))}
    </Row>
  )
}

// ============================================================
// 交易录入弹窗（买入/卖出）
// ============================================================
const TradeModal = ({ visible, onClose, onSuccess, editingTx, stocks }) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [suggesting, setSuggesting] = useState(false)
  const isSell = editingTx?.type === 'sell'

  useEffect(() => {
    if (visible && editingTx) {
      form.setFieldsValue({
        code: editingTx.code,
        name: editingTx.name,
        type: editingTx.type,
        price: editingTx.price,
        shares: editingTx.shares,
        note: editingTx.note,
      })
    } else if (visible) {
      form.resetFields()
      form.setFieldsValue({ type: 'buy' })
    }
  }, [visible, editingTx])

  const handleSearch = async (value) => {
    if (!value || value.length < 1) { setSuggestions([]); return }
    setSuggesting(true)
    try {
      const data = await searchApi.search(value)
      setSuggestions(data.results || [])
    } catch { setSuggestions([]) }
    finally { setSuggesting(false) }
  }

  const handleSelectSuggestion = (value) => {
    const stock = suggestions.find(s => s.code === value || `${s.code}` === value)
    if (stock) {
      form.setFieldsValue({ code: stock.code, name: stock.name })
    }
    setSuggestions([])
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      if (editingTx?.id) {
        // 更新备注
        await positionApi.update(editingTx.id, { note: values.note })
        message.success('已更新备注')
      } else {
        // 新增交易
        await positionApi.create(values)
        message.success(`${values.type === 'buy' ? '买入' : '卖出'}成功`)
      }
      onSuccess()
      onClose()
      form.resetFields()
    } catch (error) {
      if (!error.errorFields) message.error(error.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={editingTx?.id ? '编辑备注' : (isSell ? '卖出' : '买入')}
      open={visible}
      onOk={handleSubmit}
      onCancel={onClose}
      okText="确定"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical" size="middle">
        {!editingTx?.id && (
          <>
            <Form.Item
              name="code"
              label="股票代码"
              rules={[{ required: true, message: '请输入股票代码' }]}
            >
              <AutoComplete
                options={suggestions.map(s => ({ value: s.code, label: `${s.code} ${s.name}` }))}
                onSearch={handleSearch}
                onSelect={handleSelectSuggestion}
                placeholder="输入代码或名称搜索..."
                notFoundContent={suggesting ? '搜索中...' : '无结果'}
                style={{ width: '100%' }}
                showSearch
                filterOption={(input, option) =>
                  option.label.toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>

            <Form.Item name="name" label="股票名称">
              <Input disabled placeholder="自动填入" />
            </Form.Item>

            <Form.Item
              name="type"
              label="方向"
              rules={[{ required: true }]}
            >
              <Select placeholder="选择买入或卖出">
                <Select.Option value="buy">
                  <span style={{ color: '#ef4444' }}>买入</span>
                </Select.Option>
                <Select.Option value="sell">
                  <span style={{ color: '#22c55e' }}>卖出</span>
                </Select.Option>
              </Select>
            </Form.Item>

            <Form.Item
              name="price"
              label="成交价格（元）"
              rules={[{ required: true, message: '请输入价格' }]}
            >
              <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
            </Form.Item>

            <Form.Item
              name="shares"
              label="成交数量（股）"
              rules={[{ required: true, message: '请输入数量' }]}
            >
              <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="100" />
            </Form.Item>
          </>
        )}

        <Form.Item name="note" label="备注（可选）">
          <Select placeholder="选择或输入备注" allowClear showSearch
            options={[
              { value: '建仓', label: '建仓' },
              { value: '加仓', label: '加仓' },
              { value: '减仓', label: '减仓' },
              { value: '清仓', label: '清仓' },
              { value: '止损', label: '止损' },
              { value: '止盈', label: '止盈' },
              { value: '做T', label: '做T' },
            ]}
            onChange={v => form.setField('note', v)}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// ============================================================
// 某只股票的交易历史弹窗
// ============================================================
const HistoryModal = ({ visible, onClose, code, name }) => {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (visible && code) {
      loadHistory()
    }
  }, [visible, code])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const data = await positionApi.getHistoryByCode(code)
      setHistory(Array.isArray(data) ? data : (data.data || []))
    } catch {
      message.error('加载历史失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await positionApi.delete(id)
      message.success('已删除该笔交易')
      await loadHistory()
    } catch (error) {
      message.error('删除失败: ' + error.message)
    }
  }

  const historyColumns = [
    {
      title: '时间',
      dataIndex: 'traded_at',
      key: 'traded_at',
      width: 160,
      render: v => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    {
      title: '方向',
      dataIndex: 'type',
      key: 'type',
      width: 70,
      render: v => (
        <Tag color={v === 'buy' ? 'red' : 'green'}>
          {v === 'buy' ? '买入' : '卖出'}
        </Tag>
      )
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 90,
      render: v => `¥${v?.toFixed(2) || '-'}`
    },
    {
      title: '数量',
      dataIndex: 'shares',
      key: 'shares',
      width: 90,
      render: v => v?.toLocaleString() + '股'
    },
    {
      title: '金额',
      key: 'amount',
      width: 110,
      render: (_, r) => `¥${(r.price * r.shares).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      render: v => v || '-'
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, r) => (
        <Popconfirm
          title="确定删除该笔交易？"
          onConfirm={() => handleDelete(r.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="link" size="small" danger>删除</Button>
        </Popconfirm>
      )
    }
  ]

  return (
    <Modal
      title={`${name || code} — 交易历史`}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={800}
      destroyOnClose
    >
      {history.length === 0 && !loading ? (
        <Empty description="暂无交易记录" />
      ) : (
        <Table
          columns={historyColumns}
          dataSource={history}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
        />
      )}
    </Modal>
  )
}

// ============================================================
// 全部交易流水（可折叠）
// ============================================================
const TransactionHistory = ({ transactions, loading }) => {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [historyData, setHistoryData] = useState({ data: [], total: 0 })
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = async (pg = 1) => {
    setHistoryLoading(true)
    try {
      const result = await positionApi.getHistory(pg, 30)
      setHistoryData(result)
      setPage(pg)
    } catch { /* silent */ }
    finally { setHistoryLoading(false) }
  }

  const toggle = () => {
    if (!open) { loadHistory(1); setOpen(true) }
    else setOpen(false)
  }

  const columns = [
    {
      title: '时间',
      dataIndex: 'traded_at',
      key: 'traded_at',
      width: 160,
      render: v => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    {
      title: '股票',
      key: 'stock',
      width: 130,
      render: (_, r) => (
        <Space>
          <Tag>{r.code}</Tag>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>{r.name || ''}</span>
        </Space>
      )
    },
    {
      title: '方向',
      dataIndex: 'type',
      key: 'type',
      width: 70,
      render: v => (
        <Tag color={v === 'buy' ? 'red' : 'green'}>
          {v === 'buy' ? '买入' : '卖出'}
        </Tag>
      )
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 90,
      render: v => `¥${v?.toFixed(2) || '-'}`
    },
    {
      title: '数量',
      dataIndex: 'shares',
      key: 'shares',
      width: 100,
      render: v => v?.toLocaleString() + '股'
    },
    {
      title: '金额',
      key: 'amount',
      width: 120,
      render: (_, r) => `¥${(r.price * r.shares).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      render: v => <span style={{ color: v ? '#f59e0b' : '#9ca3af' }}>{v || '-'}</span>
    },
  ]

  return (
    <div style={{ marginTop: 16 }}>
      <Button
        type="default"
        icon={<HistoryOutlined />}
        onClick={toggle}
        style={{ marginBottom: 8 }}
      >
        {open ? '收起' : '展开'}交易流水
        {open ? <UpOutlined style={{ marginLeft: 6 }} /> : <DownOutlined style={{ marginLeft: 6 }} />}
      </Button>

      {open && (
        <>
          <Table
            columns={columns}
            dataSource={historyData.data}
            rowKey="id"
            loading={historyLoading}
            size="small"
            pagination={{
              current: page,
              total: historyData.total,
              pageSize: 30,
              onChange: loadHistory,
              showSizeChanger: false,
              showTotal: total => `共 ${total} 条`
            }}
            scroll={{ x: 800 }}
          />
        </>
      )}
    </div>
  )
}

// ============================================================
// 主页面
// ============================================================
const Positions = () => {
  const {
    positions, transactions, loading, quotes,
    fetchPositions, addTransaction, deleteTransaction, deletePositionByCode
  } = usePositionStore()

  const [tradeModalVisible, setTradeModalVisible] = useState(false)
  const [tradeType, setTradeType] = useState('buy')     // 'buy' | 'sell'
  const [selectedStock, setSelectedStock] = useState(null)
  const [historyModalVisible, setHistoryModalVisible] = useState(false)
  const [historyStock, setHistoryStock] = useState(null)
  const [masked, setMasked] = useState(false)
  const [refreshLoading, setRefreshLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      await fetchPositions(positionApi)
    } catch (error) {
      message.error('加载失败: ' + error.message)
    }
  }

  const handleRefresh = async () => {
    setRefreshLoading(true)
    try {
      await fetchPositions(positionApi)
      message.success('数据已刷新')
    } catch (error) {
      message.error('刷新失败: ' + error.message)
    } finally {
      setRefreshLoading(false)
    }
  }

  const openBuyModal = (stock = null) => {
    setSelectedStock(stock)
    setTradeType('buy')
    setTradeModalVisible(true)
  }

  const openSellModal = (stock) => {
    setSelectedStock(stock)
    setTradeType('sell')
    setTradeModalVisible(true)
  }

  const openHistoryModal = (stock) => {
    setHistoryStock(stock)
    setHistoryModalVisible(true)
  }

  const handleDeleteAll = async (code) => {
    try {
      await deletePositionByCode(positionApi, code)
      message.success(`已清空 ${code} 所有交易记录`)
    } catch (error) {
      message.error('删除失败: ' + error.message)
    }
  }

  const handleTradeSuccess = async () => {
    await loadData()
  }

  const maskVal = (v, decimals = 2) => masked ? '******' : (typeof v === 'number' ? v.toFixed(decimals) : v)

  const columns = [
    {
      title: '股票',
      key: 'stock',
      width: 130,
      fixed: 'left',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{r.code}</span>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>{r.name || ''}</span>
        </Space>
      )
    },
    {
      title: '持仓数量',
      key: 'shares',
      width: 110,
      align: 'right',
      render: (_, r) => (
        <span style={{ fontWeight: 500 }}>{masked ? '******' : formatShares(r.shares)}</span>
      )
    },
    {
      title: '成本价',
      key: 'cost',
      width: 100,
      align: 'right',
      render: (_, r) => (
        <span>{masked ? '******' : `¥${r.cost?.toFixed(2)}`}</span>
      )
    },
    {
      title: '当前价',
      key: 'currentPrice',
      width: 100,
      align: 'right',
      render: (_, r) => {
        const q = quotes[r.code]
        const price = q && !q.error ? q.price : r.currentPrice
        return (
          <span style={{ fontWeight: 600 }}>
            {`¥${price?.toFixed(2) || '-'}`}
          </span>
        )
      }
    },
    {
      title: '持仓盈亏（额/率）',
      key: 'profit',
      width: 160,
      align: 'right',
      render: (_, r) => {
        const color = profitColor(r.profit)
        return masked ? (
          <span>******</span>
        ) : (
          <Space direction="vertical" size={0} align="end">
            <span style={{ color, fontWeight: 500 }}>
              {r.profit >= 0 ? '+' : ''}{formatMoney(r.profit)}
            </span>
            <span style={{ color, fontSize: 12 }}>
              {r.profitPct >= 0 ? '+' : ''}{r.profitPct?.toFixed(2)}%
            </span>
          </Space>
        )
      }
    },
    {
      title: '当日盈亏（额/率）',
      key: 'todayProfit',
      width: 160,
      align: 'right',
      render: (_, r) => {
        const color = profitColor(r.todayProfit)
        return masked ? (
          <span>******</span>
        ) : (
          <Space direction="vertical" size={0} align="end">
            <span style={{ color, fontWeight: 500 }}>
              {r.todayProfit >= 0 ? '+' : ''}{formatMoney(r.todayProfit)}
            </span>
            <span style={{ color, fontSize: 12 }}>
              {r.todayProfitPct >= 0 ? '+' : ''}{r.todayProfitPct?.toFixed(2)}%
            </span>
          </Space>
        )
      }
    },
    {
      title: '市值',
      key: 'currentAmount',
      width: 130,
      align: 'right',
      render: (_, r) => (
        <span style={{ fontWeight: 500 }}>
          {masked ? '******' : formatMoney(r.currentAmount)}
        </span>
      )
    },
    {
      title: '仓位',
      key: 'positionPct',
      width: 80,
      align: 'right',
      render: (_, r) => (
        <span>{masked ? '******' : `${r.positionPct?.toFixed(1)}%`}</span>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Button
            type="primary" size="small" danger={false}
            icon={<PlusOutlined />}
            onClick={() => openBuyModal(r)}
            style={{ background: '#ef4444', borderColor: '#ef4444' }}
          >
            买入
          </Button>
          <Button
            type="primary" size="small"
            icon={<MinusOutlined />}
            onClick={() => openSellModal(r)}
            style={{ background: '#22c55e', borderColor: '#22c55e' }}
          >
            卖出
          </Button>
          <Button
            size="small" icon={<HistoryOutlined />}
            onClick={() => openHistoryModal(r)}
          >
            历史
          </Button>
          <Popconfirm
            title={`确定清空 ${r.code} 所有交易？`}
            description="此操作不可恢复"
            onConfirm={() => handleDeleteAll(r.code)}
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      {/* 页面标题栏 */}
      <div className="flex justify-between items-center mb-4">
        <h1 style={{ fontSize: 24, margin: 0 }}>持仓管理</h1>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={refreshLoading || loading}>
            刷新数据
          </Button>
          <Button
            icon={masked ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => setMasked(m => !m)}
          >
            {masked ? '显示' : '隐藏'}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openBuyModal(null)}>
            新增持仓
          </Button>
        </Space>
      </div>

      {/* 持仓概览卡片 */}
      <OverviewCard positions={positions} masked={masked} />

      {/* 持仓列表 */}
      {positions.length === 0 && !loading ? (
        <Empty description="暂无持仓，点击「新增持仓」开始记录" style={{ marginTop: 60 }} />
      ) : (
        <Table
          columns={columns}
          dataSource={positions}
          rowKey="code"
          loading={loading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1300 }}
          size="middle"
        />
      )}

      {/* 交易流水（可折叠） */}
      <TransactionHistory loading={loading} />

      {/* 买入/卖出弹窗 */}
      <TradeModal
        visible={tradeModalVisible}
        onClose={() => {
          setTradeModalVisible(false)
          setSelectedStock(null)
        }}
        onSuccess={handleTradeSuccess}
        editingTx={tradeType === 'sell' ? { ...selectedStock, type: 'sell' } : null}
      />

      {/* 某只股票的交易历史弹窗 */}
      <HistoryModal
        visible={historyModalVisible}
        onClose={() => {
          setHistoryModalVisible(false)
          setHistoryStock(null)
        }}
        code={historyStock?.code}
        name={historyStock?.name}
      />
    </div>
  )
}

export default Positions
