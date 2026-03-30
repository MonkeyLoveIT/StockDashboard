import React, { useEffect, useState } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Popconfirm, message, Space, Tag, Tooltip, AutoComplete } from 'antd'
import { EyeOutlined, EyeInvisibleOutlined, StarOutlined, StarFilled, ReloadOutlined } from '@ant-design/icons'
import { positionApi, quoteApi, searchApi } from '../services/api'
import usePositionStore from '../stores/useStore'

// 掩码辅助函数
const maskValue = (val, masked) => masked ? '******' : val

// 涨跌幅颜色
const getPriceColor = (value) => value > 0 ? 'red' : value < 0 ? 'green' : 'gray'
const getPriceText = (val) => {
  if (val > 0) return `+${val.toFixed(2)}`
  if (val < 0) return val.toFixed(2)
  return '0.00'
}

const Positions = () => {
  const { positions, quotes, watchList, fetchPositions, updateQuotes, addPosition, updatePosition, deletePosition, addToWatchList, removeFromWatchList } = usePositionStore()
  const [loading, setLoading] = useState(false)
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [masked, setMasked] = useState(false)
  const [form] = Form.useForm()
  const [suggestions, setSuggestions] = useState([])
  const [suggesting, setSuggesting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const positions = await fetchPositions(positionApi)
      await refreshQuotes(positions)
    } catch (error) {
      message.error('加载失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const refreshQuotes = async (positionsToUse = positions) => {
    if (positionsToUse.length === 0) return
    setQuotesLoading(true)
    try {
      const codes = positionsToUse.map(p => p.code)
      const quotesList = await quoteApi.getQuotes(codes)
      updateQuotes(quotesList)
    } catch (error) {
      console.error('Failed to refresh quotes:', error)
    } finally {
      setQuotesLoading(false)
    }
  }

  const handleRefresh = async () => {
    setLoading(true)
    try {
      await fetchPositions(positionApi)
      await refreshQuotes()
      message.success('数据已刷新')
    } catch (error) {
      message.error('刷新失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingId(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (record) => {
    setEditingId(record.id)
    form.setFieldsValue({
      code: record.code,
      name: record.name,
      cost: record.cost,
      shares: record.shares,
      position_pct: record.position_pct
    })
    setModalVisible(true)
  }

  const handleDelete = async (id) => {
    try {
      await deletePosition(positionApi, id)
      message.success('删除成功')
    } catch (error) {
      message.error('删除失败: ' + error.message)
    }
  }

  // 搜索建议（支持代码或中文名）
  const handleSearch = async (value) => {
    if (!value || value.length < 1) { setSuggestions([]); return }
    setSuggesting(true)
    try {
      const data = await searchApi.search(value)
      setSuggestions(data.results || [])
    } catch {
      setSuggestions([])
    } finally {
      setSuggesting(false)
    }
  }

  // 选择建议后自动填入代码和名称
  const handleSelectSuggestion = (value, option) => {
    const stock = suggestions.find(s => s.code === value || `${s.code}` === value)
    if (stock) {
      form.setFieldsValue({
        code: stock.code,
        name: stock.name
      })
    }
    setSuggestions([])
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingId) {
        await updatePosition(positionApi, editingId, values)
        message.success('更新成功')
      } else {
        await addPosition(positionApi, values)
        message.success('添加成功')
      }
      setModalVisible(false)
      form.resetFields()
      setSuggestions([])
    } catch (error) {
      if (error.errorFields) {
        return
      }
      message.error('操作失败: ' + error.message)
    }
  }

  const handleToggleWatchList = (code) => {
    if (watchList.includes(code)) {
      removeFromWatchList(code)
      message.success(`已从自选股移除 ${code}`)
    } else {
      addToWatchList(code)
      message.success(`已加入自选股 ${code}`)
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60, fixed: 'left' },
    { title: '股票代码', dataIndex: 'code', key: 'code', width: 110, fixed: 'left' },
    { title: '名称', dataIndex: 'name', key: 'name', width: 110 },
    // 实时行情列
    {
      title: '当前价',
      key: 'currentPrice',
      width: 110,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote || quote.error) return <span className="text-gray-400">-</span>
        return (
          <span className="font-bold">
            ¥{quote.price.toFixed(2)}
          </span>
        )
      }
    },
    {
      title: '涨跌幅',
      key: 'change',
      width: 110,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote || quote.error) return <span className="text-gray-400">-</span>
        const color = getPriceColor(quote.change)
        return (
          <Tag color={color}>
            {quote.change > 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.changePct.toFixed(2)}%)
          </Tag>
        )
      }
    },
    {
      title: '今开/昨收',
      key: 'openClose',
      width: 130,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote || quote.error) return <span className="text-gray-400">-</span>
        return (
          <Tooltip title={`今开: ${quote.open} / 昨收: ${quote.close}`}>
            <span>{quote.open.toFixed(2)} / {quote.close.toFixed(2)}</span>
          </Tooltip>
        )
      }
    },
    {
      title: '最高/最低',
      key: 'highLow',
      width: 130,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote || quote.error) return <span className="text-gray-400">-</span>
        return (
          <Tooltip title={`最高: ${quote.high} / 最低: ${quote.low}`}>
            <span>
              <span className="text-red-500">{quote.high.toFixed(2)}</span>
              {' / '}
              <span className="text-green-500">{quote.low.toFixed(2)}</span>
            </span>
          </Tooltip>
        )
      }
    },
    {
      title: '成交量/成交额',
      key: 'volumeAmount',
      width: 150,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote || quote.error) return <span className="text-gray-400">-</span>
        const vol = (quote.volume / 10000).toFixed(2) + '万手'
        const amt = quote.amount > 100000000
          ? (quote.amount / 100000000).toFixed(2) + '亿'
          : (quote.amount / 10000).toFixed(2) + '万'
        return (
          <Tooltip title={`成交量: ${quote.volume}手 / 成交额: ¥${quote.amount.toFixed(2)}`}>
            <span>{vol} / {amt}</span>
          </Tooltip>
        )
      }
    },
    {
      title: '涨停/跌停',
      key: 'limit',
      width: 130,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote || quote.error) return <span className="text-gray-400">-</span>
        return (
          <Tooltip title={`涨停: ¥${quote.highLimit?.toFixed(2)} / 跌停: ¥${quote.lowLimit?.toFixed(2)}`}>
            <span>
              <span className="text-red-500">{quote.highLimit?.toFixed(2)}</span>
              {' / '}
              <span className="text-green-500">{quote.lowLimit?.toFixed(2)}</span>
            </span>
          </Tooltip>
        )
      }
    },
    // 持仓信息列
    {
      title: '成本价',
      dataIndex: 'cost',
      key: 'cost',
      width: 100,
      render: (val) => `¥${maskValue(val.toFixed(2), masked)}`
    },
    {
      title: '持仓数量',
      dataIndex: 'shares',
      key: 'shares',
      width: 100,
      render: (val) => `${maskValue(val, masked)}股`
    },
    {
      title: '仓位比例',
      dataIndex: 'position_pct',
      key: 'position_pct',
      width: 100,
      render: (val) => maskValue(val ? `${val}%` : '-', masked)
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (val) => val ? new Date(val).toLocaleString() : '-'
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={watchList.includes(record.code) ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
            onClick={() => handleToggleWatchList(record.code)}
            title={watchList.includes(record.code) ? '从自选股移除' : '加入自选股'}
          />
          <Button type="link" size="small" onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm
            title="确定删除？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 style={{ fontSize: 24, margin: 0 }}>持仓管理</h1>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading || quotesLoading}
          >
            刷新数据
          </Button>
          <Button
            icon={masked ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => setMasked(m => !m)}
          >
            {masked ? '显示敏感信息' : '隐藏敏感信息'}
          </Button>
          <Button type="primary" onClick={handleAdd}>新增持仓</Button>
        </Space>
      </div>

      {quotesLoading && positions.length > 0 && (
        <div className="text-sm text-gray-400 mb-2">行情刷新中...</div>
      )}

      <Table
        columns={columns}
        dataSource={positions}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 1600 }}
      />

      <Modal
        title={editingId ? '编辑持仓' : '新增持仓'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => {
          setModalVisible(false)
          form.resetFields()
          setSuggestions([])
        }}
        okText="确定"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="股票代码"
            rules={[{ required: true, message: '请输入股票代码' }]}
          >
            <AutoComplete
              options={suggestions.map(s => ({ value: s.code, label: `${s.code} ${s.name}` }))}
              onSearch={handleSearch}
              onSelect={handleSelectSuggestion}
              onChange={() => {}}
              placeholder="输入代码或名称搜索..."
              disabled={!!editingId}
              notFoundContent={suggesting ? '搜索中...' : '无结果'}
              style={{ width: '100%' }}
              filterOption={(input, option) =>
                option.label.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="name" label="股票名称">
            <Input placeholder="从上方选择后自动填入，或手动输入" />
          </Form.Item>
          <Form.Item
            name="cost"
            label="成本价"
            rules={[{ required: true, message: '请输入成本价' }]}
          >
            <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
          </Form.Item>
          <Form.Item
            name="shares"
            label="持仓数量"
            rules={[{ required: true, message: '请输入持仓数量' }]}
          >
            <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="100" />
          </Form.Item>
          <Form.Item name="position_pct" label="仓位比例 (%)">
            <InputNumber style={{ width: '100%' }} min={0} max={100} precision={2} placeholder="10" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Positions
