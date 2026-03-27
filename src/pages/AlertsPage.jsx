import React, { useEffect, useState, useRef } from 'react'
import { Card, Table, Button, Modal, Form, InputNumber, Select, Popconfirm, message, Tag, Space, Switch, Empty, Tabs } from 'antd'
import { BellOutlined, DeleteOutlined, PlusOutlined, CheckCircleFilled, BellFilled } from '@ant-design/icons'
import { positionApi, quoteApi } from '../services/api'
import { loadAlerts, saveAlerts, removeAlert as removeAlertSvc, toggleAlert, resetAlert } from '../services/alertService'
import { notifyApi } from '../services/api'
import usePositionStore from '../stores/useStore'

const SIGNAL_TYPES = [
  { label: 'MA均线金叉', value: 'ma_gold' },
  { label: 'MA均线死叉', value: 'ma_death' },
  { label: 'KDJ金叉', value: 'kdj_gold' },
  { label: 'KDJ死叉', value: 'kdj_death' },
  { label: 'MACD水上金叉', value: 'macd_cross_up' },
  { label: 'MACD水下死叉', value: 'macd_cross_down' },
]

const AlertsPage = () => {
  const { positions, quotes, fetchPositions, updateQuotes } = usePositionStore()
  const [alerts, setAlerts] = useState([])
  const [modalVisible, setModalVisible] = useState(false)
  const [form] = Form.useForm()
  const [activeTab, setActiveTab] = useState('price')
  const lastCheckRef = useRef({})
  const pollingRef = useRef(null)

  useEffect(() => {
    loadAllAlerts()
    loadPositionsAndStartPolling()
    return () => clearInterval(pollingRef.current)
  }, [])

  const loadAllAlerts = () => {
    setAlerts(loadAlerts())
  }

  const loadPositionsAndStartPolling = async () => {
    await fetchPositions(positionApi)
    checkAlertsLoop()
    pollingRef.current = setInterval(checkAlertsLoop, 30000) // 每30秒检查
  }

  const checkAlertsLoop = async () => {
    if (positions.length === 0) return

    const currentAlerts = loadAlerts()
    const enabledAlerts = currentAlerts.filter(a => a.enabled && !a.triggered)
    if (enabledAlerts.length === 0) return

    const codes = [...new Set(enabledAlerts.map(a => a.code))]
    try {
      const quotesList = await quoteApi.getQuotes(codes)
      updateQuotes(quotesList)
      await processTriggers(enabledAlerts, quotesList)
    } catch (e) {
      console.error('Alert check failed:', e)
    }
  }

  const processTriggers = async (enabledAlerts, quotes) => {
    const now = Date.now()
    const toNotify = []

    for (const alert of enabledAlerts) {
      // 冷却：同一代码5分钟内不重复提醒
      if (lastCheckRef.current[alert.code] && now - lastCheckRef.current[alert.code] < 5 * 60 * 1000) {
        continue
      }

      const quote = quotes.find(q => q.code === alert.code)
      if (!quote || quote.error) continue

      let triggered = false
      const price = quote.price
      const target = parseFloat(alert.value)

      if (alert.type === 'above' && price >= target) triggered = true
      if (alert.type === 'below' && price <= target) triggered = true

      if (triggered) {
        lastCheckRef.current[alert.code] = now
        toNotify.push({ alert, price })

        // 标记触发
        const all = loadAlerts()
        const idx = all.findIndex(a => a.id === alert.id)
        if (idx !== -1) { all[idx].triggered = true; saveAlerts(all) }
      }
    }

    if (toNotify.length > 0) {
      loadAllAlerts() // 刷新列表
      for (const { alert, price } of toNotify) {
        try {
          if (alert.type === 'above') {
            await notifyApi.send({
              title: `📈 到价提醒：${alert.name || alert.code}`,
              content: `当前价 ¥${price.toFixed(2)} ≥ 提醒价 ¥${alert.value}（上涨提醒）`
            })
          } else if (alert.type === 'below') {
            await notifyApi.send({
              title: `📉 到价提醒：${alert.name || alert.code}`,
              content: `当前价 ¥${price.toFixed(2)} ≤ 提醒价 ¥${alert.value}（下跌提醒）`
            })
          }
          message.success(`已推送提醒：${alert.name || alert.code}`)
        } catch (e) {
          message.error('提醒推送失败：' + e.message)
        }
      }
    }
  }

  const handleAddAlert = async () => {
    try {
      const values = await form.validateFields()
      const selectedPos = positions.find(p => p.code === values.code)

      const { addAlert: add } = await import('../services/alertService')
      add({
        ...values,
        name: selectedPos?.name || values.code,
        enabled: true
      })
      loadAllAlerts()
      setModalVisible(false)
      form.resetFields()
      message.success('提醒已设置')
    } catch (e) {
      if (e.errorFields) return
      message.error('添加失败：' + e.message)
    }
  }

  const handleDelete = (id) => {
    removeAlertSvc(id)
    loadAllAlerts()
    message.success('已删除')
  }

  const handleToggle = (id) => {
    toggleAlert(id)
    loadAllAlerts()
  }

  const handleReset = (id) => {
    resetAlert(id)
    loadAllAlerts()
    message.success('已重置，可再次触发')
  }

  const priceAlerts = alerts.filter(a => a.type === 'above' || a.type === 'below')
  const signalAlerts = alerts.filter(a => a.type === 'signal')

  const priceColumns = [
    { title: '股票', dataIndex: 'code', key: 'code', render: (v, r) => `${r.name || v} (${v})` },
    { title: '类型', dataIndex: 'type', key: 'type', render: t => <Tag color={t === 'above' ? 'red' : 'green'}>{t === 'above' ? '涨到提醒' : '跌到提醒'}</Tag> },
    { title: '目标价', dataIndex: 'value', key: 'value', render: v => `¥${v}` },
    { title: '状态', key: 'status', render: (_, r) => r.triggered ? <Tag color="default" icon={<CheckCircleFilled />}>已触发</Tag> : r.enabled ? <Tag color="green">监控中</Tag> : <Tag color="gray">已暂停</Tag> },
    { title: '操作', key: 'action', render: (_, r) => (
      <Space>
        <Switch size="small" checked={r.enabled} onChange={() => handleToggle(r.id)} />
        {r.triggered && <Button size="small" onClick={() => handleReset(r.id)}>重置</Button>}
        <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )}
  ]

  const signalColumns = [
    { title: '股票', dataIndex: 'code', key: 'code', render: (v, r) => `${r.name || v} (${v})` },
    { title: '信号类型', dataIndex: 'value', key: 'value', render: v => <Tag>{SIGNAL_TYPES.find(s => s.value === v)?.label || v}</Tag> },
    { title: '状态', key: 'status', render: (_, r) => r.triggered ? <Tag color="default" icon={<CheckCircleFilled />}>已触发</Tag> : r.enabled ? <Tag color="green">监控中</Tag> : <Tag color="gray">已暂停</Tag> },
    { title: '操作', key: 'action', render: (_, r) => (
      <Space>
        <Switch size="small" checked={r.enabled} onChange={() => handleToggle(r.id)} />
        {r.triggered && <Button size="small" onClick={() => handleReset(r.id)}>重置</Button>}
        <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )}
  ]

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 style={{ fontSize: 24, margin: 0 }}>价格 & 信号提醒</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
          添加提醒
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'price',
            label: `到价提醒 (${priceAlerts.length})`,
            children: (
              <Card>
                {priceAlerts.length === 0 ? (
                  <Empty description="暂无到价提醒，点击右上角添加" />
                ) : (
                  <Table columns={priceColumns} dataSource={priceAlerts} rowKey="id" pagination={false} size="small" />
                )}
              </Card>
            )
          },
          {
            key: 'signal',
            label: `信号提醒 (${signalAlerts.length})`,
            children: (
              <Card>
                {signalAlerts.length === 0 ? (
                  <Empty description="暂无信号提醒，点击右上角添加" />
                ) : (
                  <Table columns={signalColumns} dataSource={signalAlerts} rowKey="id" pagination={false} size="small" />
                )}
              </Card>
            )
          }
        ]}
      />

      <Modal
        title="添加提醒"
        open={modalVisible}
        onOk={handleAddAlert}
        onCancel={() => { setModalVisible(false); form.resetFields() }}
        okText="添加"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="持仓股票" rules={[{ required: true, message: '请选择持仓股票' }]}>
            <Select placeholder="选择持仓股票">
              {positions.map(p => (
                <Select.Option key={p.code} value={p.code}>
                  {p.name || p.code} ({p.code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="type" label="提醒类型" rules={[{ required: true }]}>
            <Select placeholder="选择提醒类型">
              <Select.Option value="above">涨到（价格 ≥ 目标价）</Select.Option>
              <Select.Option value="below">跌到（价格 ≤ 目标价）</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="value"
            label="目标价格"
            rules={[{ required: true, message: '请输入目标价格' }]}
          >
            <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="如: 10.00" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default AlertsPage
