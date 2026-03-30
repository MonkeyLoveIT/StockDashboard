import React, { useEffect, useState, useRef } from 'react'
import { Card, Table, Button, Modal, Form, InputNumber, Select, Popconfirm, message, Tag, Space, Switch, Empty, Tabs } from 'antd'
import { BellOutlined, DeleteOutlined, PlusOutlined, CheckCircleFilled, BellFilled } from '@ant-design/icons'
import { positionApi, quoteApi, klineApi } from '../services/api'
import { loadAlerts, saveAlerts, removeAlert as removeAlertSvc, toggleAlert, resetAlert, addAlert } from '../services/alertService'
import { notifyApi } from '../services/api'
import usePositionStore from '../stores/useStore'

// 计算简单移动平均
const calculateMA = (closes, period) => {
  const result = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      const slice = closes.slice(i - period + 1, i + 1)
      result.push(slice.reduce((a, b) => a + b, 0) / period)
    }
  }
  return result
}

const SIGNAL_TYPES = [
  // 到价提醒（价格区间）
  { label: '涨到（价格 ≥ 目标价）', value: 'above', group: 'price', needValue: true },
  { label: '跌到（价格 ≤ 目标价）', value: 'below', group: 'price', needValue: true },
  // MA 均线提醒
  { label: 'MA5 触碰', value: 'ma5_touch', group: 'ma', needValue: false },
  { label: 'MA5 跌破', value: 'ma5_break', group: 'ma', needValue: false },
  { label: 'MA10 触碰', value: 'ma10_touch', group: 'ma', needValue: false },
  { label: 'MA10 跌破', value: 'ma10_break', group: 'ma', needValue: false },
  { label: 'MA20 触碰', value: 'ma20_touch', group: 'ma', needValue: false },
  { label: 'MA20 跌破', value: 'ma20_break', group: 'ma', needValue: false },
  // 技术指标
  { label: 'KDJ 金叉', value: 'kdj_gold', group: 'indicator', needValue: false },
  { label: 'KDJ 死叉', value: 'kdj_death', group: 'indicator', needValue: false },
  { label: 'MACD 金叉', value: 'macd_gold_cross', group: 'indicator', needValue: false },
  { label: 'MACD 死叉', value: 'macd_death_cross', group: 'indicator', needValue: false },
]

const TYPE_LABELS = {
  above: '涨到提醒', below: '跌到提醒',
  ma5_touch: 'MA5触碰', ma5_break: 'MA5跌破',
  ma10_touch: 'MA10触碰', ma10_break: 'MA10跌破',
  ma20_touch: 'MA20触碰', ma20_break: 'MA20跌破',
  kdj_gold: 'KDJ金叉', kdj_death: 'KDJ死叉',
  macd_gold_cross: 'MACD金叉', macd_death_cross: 'MACD死叉',
}

const AlertsPage = () => {
  const { positions, quotes, fetchPositions, updateQuotes } = usePositionStore()
  const [alerts, setAlerts] = useState([])
  const [modalVisible, setModalVisible] = useState(false)
  const [form] = Form.useForm()
  const [activeTab, setActiveTab] = useState('price')
  const [alertCategory, setAlertCategory] = useState('price')
  const lastCheckRef = useRef({})
  const pollingRef = useRef(null)
  const [maValues, setMaValues] = useState({}) // { code: { ma5, ma10, ma20 } }

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
    pollingRef.current = setInterval(checkAlertsLoop, 30000)
  }

  // 判断信号类型（基于 type=value 的 signal 类提醒）
  const isSignalType = (type) => type && type !== 'above' && type !== 'below'
  // 判断是否为 MA 均线类提醒
  const isMAType = (type) => type && type.startsWith('ma')

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

  const processTriggers = async (enabledAlerts, quotesList) => {
    const now = Date.now()
    const toNotify = []

    // 分离价格提醒和信号/MA提醒
    const priceAlerts = enabledAlerts.filter(a => a.type === 'above' || a.type === 'below')
    const signalAlerts = enabledAlerts.filter(a => isSignalType(a.type) && isMAType(a.type))

    // 处理价格提醒
    for (const alert of priceAlerts) {
      if (lastCheckRef.current[alert.code] && now - lastCheckRef.current[alert.code] < 5 * 60 * 1000) {
        continue
      }
      const quote = quotesList.find(q => q.code === alert.code)
      if (!quote || quote.error) continue

      const price = quote.price
      const target = parseFloat(alert.value)
      let triggered = false
      if (alert.type === 'above' && price >= target) triggered = true
      if (alert.type === 'below' && price <= target) triggered = true

      if (triggered) {
        lastCheckRef.current[alert.code] = now
        toNotify.push({ alert, price, priceType: alert.type })
        markTriggered(alert.id)
      }
    }

    // 处理 MA 均线提醒
    const maAlertCodes = [...new Set(signalAlerts.map(a => a.code))]
    const maKlineCache = {}
    for (const code of maAlertCodes) {
      try {
        const kdata = await klineApi.getKline(code, 'd')
        if (kdata.klines && kdata.klines.length > 0) {
          const closes = kdata.klines.map(k => k.close)
          const ma5 = calculateMA(closes, 5)
          const ma10 = calculateMA(closes, 10)
          const ma20 = calculateMA(closes, 20)
          const currentPrice = closes[closes.length - 1]
          maKlineCache[code] = {
            closes,
            ma5: ma5[ma5.length - 1],
            ma10: ma10[ma10.length - 1],
            ma20: ma20[ma20.length - 1],
            currentPrice
          }
          // 更新 MA 展示值
          setMaValues(prev => ({
            ...prev,
            [code]: { ma5: ma5[ma5.length - 1], ma10: ma10[ma10.length - 1], ma20: ma20[ma20.length - 1] }
          }))
        }
      } catch (e) {
        console.error('Failed to fetch kline for', code, e.message)
      }
    }

    for (const alert of signalAlerts) {
      if (lastCheckRef.current[alert.code] && now - lastCheckRef.current[alert.code] < 5 * 60 * 1000) {
        continue
      }
      const cache = maKlineCache[alert.code]
      if (!cache) continue

      let triggered = false
      const { closes, ma5, ma10, ma20 } = cache
      const cur = closes[closes.length - 1]
      const prev = closes[closes.length - 2]

      // 获取均线值
      const maMap = { ma5, ma10, ma20 }
      const maPeriod = alert.type.match(/^ma(\d+)/)?.[1]
      const maVal = maMap[alert.type.replace('_touch', '').replace('_break', '')]

      if (!maVal) continue

      if (alert.type === 'ma5_touch') {
        // 触碰：价格刚好触及均线（前一根在均线下，当前在均线上，或反之）
        triggered = (prev < maVal && cur >= maVal) || (prev > maVal && cur <= maVal)
      } else if (alert.type === 'ma5_break') {
        // 跌破：从均线上方跌到下方（当前<均线 且 前3日内曾>均线）
        if (cur < maVal) {
          const recentAbove = closes.slice(-4, -1).some(c => c > maVal)
          if (recentAbove) triggered = true
        }
      } else if (alert.type === 'ma10_touch') {
        triggered = (prev < maVal && cur >= maVal) || (prev > maVal && cur <= maVal)
      } else if (alert.type === 'ma10_break') {
        if (cur < maVal) {
          const recentAbove = closes.slice(-4, -1).some(c => c > maVal)
          if (recentAbove) triggered = true
        }
      } else if (alert.type === 'ma20_touch') {
        triggered = (prev < maVal && cur >= maVal) || (prev > maVal && cur <= maVal)
      } else if (alert.type === 'ma20_break') {
        if (cur < maVal) {
          const recentAbove = closes.slice(-4, -1).some(c => c > maVal)
          if (recentAbove) triggered = true
        }
      }

      if (triggered) {
        lastCheckRef.current[alert.code] = now
        toNotify.push({ alert, priceType: 'ma', currentPrice: cur, maValue: maVal, maType: alert.type })
        markTriggered(alert.id)
      }
    }

    if (toNotify.length > 0) {
      loadAllAlerts()
      for (const item of toNotify) {
        try {
          if (item.priceType === 'above') {
            await notifyApi.send({
              title: `📈 到价提醒：${item.alert.name || item.alert.code}`,
              content: `当前价 ¥${item.price.toFixed(2)} ≥ 提醒价 ¥${item.alert.value}（上涨提醒）`
            })
          } else if (item.priceType === 'below') {
            await notifyApi.send({
              title: `📉 到价提醒：${item.alert.name || item.alert.code}`,
              content: `当前价 ¥${item.price.toFixed(2)} ≤ 提醒价 ¥${item.alert.value}（下跌提醒）`
            })
          } else if (item.maType) {
            const maLabel = TYPE_LABELS[item.maType] || item.maType
            await notifyApi.send({
              title: `📊 MA均线提醒：${item.alert.name || item.alert.code}`,
              content: `触发信号：${maLabel}\n当前价 ¥${item.currentPrice?.toFixed(2)}，当前MA值 ¥${item.maValue?.toFixed(2)}`
            })
          }
          message.success(`已推送提醒：${item.alert.name || item.alert.code}`)
        } catch (e) {
          message.error('提醒推送失败：' + e.message)
        }
      }
    }
  }

  const markTriggered = (id) => {
    const all = loadAlerts()
    const idx = all.findIndex(a => a.id === id)
    if (idx !== -1) { all[idx].triggered = true; saveAlerts(all) }
  }

  const handleAddAlert = async () => {
    try {
      const values = await form.validateFields()
      const selectedPos = positions.find(p => p.code === values.code)
      const signalType = SIGNAL_TYPES.find(s => s.value === values.type)

      addAlert({
        ...values,
        name: selectedPos?.name || values.code,
        enabled: true
      })
      loadAllAlerts()
      setModalVisible(false)
      form.resetFields()
      setAlertCategory('price')
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
  const signalAlerts = alerts.filter(a => isSignalType(a.type))

  const priceColumns = [
    { title: '股票', dataIndex: 'code', key: 'code', render: (v, r) => `${r.name || v} (${v})` },
    { title: '类型', dataIndex: 'type', key: 'type', render: t => <Tag color={t === 'above' ? 'red' : 'green'}>{TYPE_LABELS[t] || t}</Tag> },
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
    { title: '信号类型', dataIndex: 'type', key: 'type', render: t => <Tag color="blue">{TYPE_LABELS[t] || t}</Tag> },
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

  const currentMA = maValues[form.getFieldValue('code')]
  const selectedType = form.getFieldValue('type')
  const selectedTypeDef = SIGNAL_TYPES.find(s => s.value === selectedType)
  const showValueField = selectedTypeDef?.needValue

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
        onCancel={() => { setModalVisible(false); form.resetFields(); setAlertCategory('price') }}
        okText="添加"
        cancelText="取消"
        width={480}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="持仓股票" rules={[{ required: true, message: '请选择持仓股票' }]}>
            <Select placeholder="选择持仓股票" showSearch optionFilterProp="children">
              {positions.map(p => (
                <Select.Option key={p.code} value={p.code}>
                  {p.name || p.code} ({p.code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="type" label="提醒类型" rules={[{ required: true, message: '请选择提醒类型' }]}>
            <Select placeholder="选择提醒类型">
              <Select.OptGroup label="— 到价提醒 —">
                <Select.Option value="above">涨到（价格 ≥ 目标价）</Select.Option>
                <Select.Option value="below">跌到（价格 ≤ 目标价）</Select.Option>
              </Select.OptGroup>
              <Select.OptGroup label="— MA 均线提醒 —">
                <Select.Option value="ma5_touch">MA5 触碰</Select.Option>
                <Select.Option value="ma5_break">MA5 跌破</Select.Option>
                <Select.Option value="ma10_touch">MA10 触碰</Select.Option>
                <Select.Option value="ma10_break">MA10 跌破</Select.Option>
                <Select.Option value="ma20_touch">MA20 触碰</Select.Option>
                <Select.Option value="ma20_break">MA20 跌破</Select.Option>
              </Select.OptGroup>
              <Select.OptGroup label="— 技术指标 —">
                <Select.Option value="kdj_gold">KDJ 金叉</Select.Option>
                <Select.Option value="kdj_death">KDJ 死叉</Select.Option>
                <Select.Option value="macd_gold_cross">MACD 金叉</Select.Option>
                <Select.Option value="macd_death_cross">MACD 死叉</Select.Option>
              </Select.OptGroup>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.type !== curr.type}
          >
            {({ getFieldValue }) => {
              const type = getFieldValue('type')
              const typeDef = SIGNAL_TYPES.find(s => s.value === type)
              if (typeDef?.needValue) {
                return (
                  <Form.Item
                    name="value"
                    label="目标价格"
                    rules={[{ required: true, message: '请输入目标价格' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="如: 10.00" />
                  </Form.Item>
                )
              }
              return null
            }}
          </Form.Item>

          {selectedType && selectedType.startsWith('ma') && (() => {
            const code = form.getFieldValue('code')
            const ma = maValues[code]
            if (ma) {
              const period = selectedType.match(/^ma(\d+)/)?.[1]
              const maKey = `ma${period}`
              const val = ma[maKey]
              if (val) {
                return (
                  <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '12px 16px', marginBottom: 12, fontSize: 13 }}>
                    <span style={{ color: '#888' }}>当前 MA{period}：</span>
                    <span style={{ color: '#389e0d', fontWeight: 600, marginLeft: 8 }}>¥{val.toFixed(2)}</span>
                  </div>
                )
              }
            }
            return (
              <div style={{ background: '#fffbe6', borderRadius: 6, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: '#ad6800' }}>
                均线值将在添加后自动计算，请先添加提醒
              </div>
            )
          })()}
        </Form>
      </Modal>
    </div>
  )
}

export default AlertsPage
