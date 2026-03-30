import React, { useState, useEffect } from "react"
import { Card, Row, Col, Button, Tag, Space, Spin, Empty, Typography, Checkbox, message, Alert, Collapse, Switch, Select, TimePicker, Divider } from "antd"
import { RocketOutlined, ThunderboltOutlined, FireOutlined, RiseOutlined, BankOutlined, ClockCircleOutlined, BellOutlined } from "@ant-design/icons"
import { screenerApi, notifyApi, quoteApi } from "../services/api"
import usePositionStore from "../stores/useStore"
import dayjs from "dayjs"

const { Text } = Typography
const { Panel } = Collapse

const API_BASE = '/api'

const MODES = [
  { key: "oversold_rebound", label: "底部反弹", icon: <RocketOutlined />, color: "#52c41a", desc: "RSI超卖 + 远离低点 + 缩量止跌，适合超跌反弹", tags: ["超跌反弹", "量能萎缩", "低位布局"] },
  { key: "uptrend", label: "趋势上涨", icon: <RiseOutlined />, color: "#1677ff", desc: "温和涨幅 + 高换手 + 低开高走，适合顺势而为", tags: ["趋势向上", "量价配合", "稳健获利"] },
  { key: "hot_money", label: "热门资金", icon: <FireOutlined />, color: "#fa8c16", desc: "高换手 + 涨幅适中 + 成交活跃，适合短线热点追踪", tags: ["资金活跃", "短线热点", "快速获利"] },
  { key: "breakthrough", label: "突破拉升", icon: <ThunderboltOutlined />, color: "#722ed1", desc: "突破前高 + 放量上涨 + 跳空高开，适合突破行情", tags: ["突破新高", "动能充足", "快速拉升"] },
  { key: "long_value", label: "价值布局", icon: <BankOutlined />, color: "#13c2c2", desc: "股价稳定 + 低换手 + 小幅回调，适合长线布局", tags: ["低估值", "筹码稳定", "长线持有"] },
]

// Cron API helpers
const cronApi = {
  getConfig: async () => {
    const res = await fetch(`${API_BASE}/cron/config`)
    if (!res.ok) throw new Error('Failed to fetch cron config')
    return res.json()
  },
  updateConfig: async (schedules) => {
    const res = await fetch(`${API_BASE}/cron/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedules })
    })
    if (!res.ok) throw new Error('Failed to update cron config')
    return res.json()
  },
}

// Parse cron "55 8 * * 1-5" → dayjs time object for TimePicker
function cronToDayjs(schedule) {
  const parts = schedule.split(' ')
  if (parts.length < 5) return null
  const [min, hour] = parts.slice(0, 2).map(Number)
  if (isNaN(min) || isNaN(hour)) return null
  return dayjs().hour(hour).minute(min).second(0)
}

// Convert dayjs + days-of-week → cron string
function dayjsToCron(dayjsTime, days = [1, 2, 3, 4, 5]) {
  const min = dayjsTime.minute()
  const hour = dayjsTime.hour()
  const daysStr = days.join(',')
  return `${min} ${hour} * * ${daysStr}`
}

const StockCard = ({ stock, selectedModes, onAdd }) => {
  const isUp = stock.change >= 0
  const changeColor = isUp ? "#e24a4a" : "#52c41a"
  const stars = Math.min(5, Math.max(1, Math.round(stock.avgScore / 20)))

  return (
    <Card size="small" className="mb-3 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-bold text-base">{stock.name}</div>
          <div className="text-xs text-gray-400">{stock.code}</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-lg">¥{stock.price?.toFixed(2)}</div>
          <div style={{ color: changeColor, fontSize: 13 }}>{isUp ? "+" : ""}{stock.change?.toFixed(2)} ({isUp ? "+" : ""}{stock.changePct?.toFixed(2)}%)</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Text type="secondary" style={{ fontSize: 12 }}>综合评分</Text>
        <Space size={2}>
          {[1, 2, 3, 4, 5].map(i => <span key={i} style={{ color: i <= stars ? "#faad14" : "#d9d9d9", fontSize: 14 }}>★</span>)}
        </Space>
        <Tag color={stock.riskLevel === "低" ? "green" : stock.riskLevel === "中" ? "orange" : "red"}>{stock.riskLevel}风险</Tag>
        {(stock.strategies || []).map(s => <Tag key={s} color="blue">{s}</Tag>)}
      </div>

      {selectedModes.length > 1 && stock.modeScores && (
        <div className="mb-3 p-2 rounded" style={{ background: "#f5f5f5" }}>
          <Text type="secondary" style={{ fontSize: 11 }}>各模式得分：</Text>
          <div className="flex flex-wrap gap-2 mt-1">
            {Object.entries(stock.modeScores).map(([mode, data]) => (
              <Tag key={mode} color={data.score >= 50 ? "green" : data.score >= 30 ? "orange" : "red"}>
                {MODES.find(m => m.key === mode)?.label} {data.score}分
              </Tag>
            ))}
          </div>
        </div>
      )}

      <Row gutter={8} className="mb-3">
        <Col span={8}>
          <div style={{ fontSize: 11, color: "#999" }}>换手率</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{stock.turnover !== "-" ? stock.turnover + "%" : "-"}</div>
        </Col>
        <Col span={8}>
          <div style={{ fontSize: 11, color: "#999" }}>成交额</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{stock.amount > 1e8 ? (stock.amount / 1e8).toFixed(1) + "亿" : stock.amount > 1e4 ? (stock.amount / 1e4).toFixed(0) + "万" : "-"}</div>
        </Col>
        <Col span={8}>
          <div style={{ fontSize: 11, color: "#999" }}>量能状态</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fa8c16" }}>{stock.volProxy || "-"}</div>
        </Col>
      </Row>

      {stock.reasons?.length > 0 && (
        <div className="mb-3">
          <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>推荐理由：</div>
          {stock.reasons.map((r, i) => <Tag key={i} color="blue" style={{ marginBottom: 2, fontSize: 11 }}>{r}</Tag>)}
        </div>
      )}

      <Button size="small" onClick={() => onAdd(stock)}>+ 自选股</Button>
    </Card>
  )
}

// ============ Cron Config Panel ============
const CronConfigPanel = ({ onSaved }) => {
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(null) // schedule name being tested

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const data = await cronApi.getConfig()
      setSchedules(data.schedules || [])
    } catch (e) {
      message.error('加载定时配置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await cronApi.updateConfig(schedules)
      message.success('定时推送配置已保存')
      onSaved?.()
    } catch (e) {
      message.error('保存失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = (idx) => {
    setSchedules(prev => prev.map((s, i) => i === idx ? { ...s, enabled: !s.enabled } : s))
  }

  const updateTime = (idx, time) => {
    if (!time) return
    setSchedules(prev => prev.map((s, i) => {
      if (i !== idx) return s
      const newSchedule = dayjsToCron(time)
      return { ...s, schedule: newSchedule }
    }))
  }

  const updateModes = (idx, modes) => {
    setSchedules(prev => prev.map((s, i) => i === idx ? { ...s, modes } : s))
  }

  const handleTest = async (schedule) => {
    setTesting(schedule.name)
    try {
      const modeParams = schedule.modes.map(m => `mode=${m}`).join('&')
      const resp = await fetch(`${API_BASE}/screener/run?${modeParams}&limit=${schedule.limit || 20}`)
      if (!resp.ok) throw new Error('筛选接口请求失败: ' + resp.status)
      const data = await resp.json()
      const results = data.results || []
      const total = data.total || results.length

      // Format report content (same as cron.js)
      const MODE_LABELS = { oversold_rebound: '底部反弹', uptrend: '趋势上涨', hot_money: '热门资金', breakthrough: '突破买入', long_value: '长线价值' }
      const modeLabelStr = schedule.modes.map(m => MODE_LABELS[m] || m).join('、')
      const top5 = results.slice(0, 5)
      const lines = top5.map((stock, i) => {
        const changeStr = stock.change >= 0 ? `+${stock.change.toFixed(2)}` : stock.change.toFixed(2)
        const pctStr = stock.changePct >= 0 ? `+${stock.changePct.toFixed(2)}` : stock.changePct.toFixed(2)
        const reasons = (stock.reasons || []).slice(0, 2).join('; ')
        return `${i + 1}. ${stock.name}(${stock.code}) ¥${stock.price.toFixed(2)} ${changeStr}(${pctStr}%) 综合评分${stock.avgScore}${reasons ? `\n   推荐理由：${reasons}` : ''}`
      })
      const content = [
        `筛选模式：${modeLabelStr}`,
        '符合条件股票 TOP 5：',
        ...lines,
        '',
        `共筛出 ${total} 只股票，仅展示前 5`,
        '仅供参考，不构成投资建议。',
      ].join('\n')

      const title = `📊 ${schedule.name} 智能选股报告`

      // Actually send the Feishu notification
      const notifyResp = await fetch(`${API_BASE}/notify/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      })
      if (!notifyResp.ok) throw new Error('飞书通知发送失败: ' + notifyResp.status)

      const notifyData = await notifyResp.json()
      if (notifyData.success) {
        message.success(`测试推送成功！已将报告发送到飞书（共 ${top5.length} 条）`)
      } else {
        throw new Error(notifyData.error || '飞书通知发送失败')
      }
    } catch (e) {
      message.error('测试失败: ' + e.message)
    } finally {
      setTesting(null)
    }
  }

  if (loading) return <div className="text-center py-4"><Spin size="small" /> 加载配置中...</div>

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <div className="flex justify-between items-center mb-3">
        <Space>
          <BellOutlined />
          <Text strong>定时推送配置</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>每个任务仅在交易日（周一至周五）执行</Text>
        </Space>
        <Space>
          <Button size="small" onClick={loadConfig}>重置</Button>
          <Button type="primary" size="small" onClick={handleSave} loading={saving}>保存配置</Button>
        </Space>
      </div>

      {schedules.length === 0 && (
        <Empty description="暂无定时任务" />
      )}

      {schedules.map((schedule, idx) => {
        const timeValue = cronToDayjs(schedule.schedule)
        return (
          <div key={idx} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
            <div className="flex justify-between items-center mb-2">
              <Space>
                <Switch size="small" checked={schedule.enabled} onChange={() => toggleEnabled(idx)} />
                <Text strong style={{ color: schedule.enabled ? '#1677ff' : '#999' }}>{schedule.name}</Text>
              </Space>
              <Button size="small" onClick={() => handleTest(schedule)} loading={testing === schedule.name} disabled={!schedule.enabled}>
                测试推送
              </Button>
            </div>

            <div className="flex gap-4 items-center" style={{ opacity: schedule.enabled ? 1 : 0.5 }}>
              <div>
                <Text type="secondary" style={{ fontSize: 11 }}>推送时间</Text>
                <div>
                  <TimePicker
                    size="small"
                    value={timeValue}
                    onChange={(t) => updateTime(idx, t)}
                    format="HH:mm"
                    disabled={!schedule.enabled}
                    style={{ width: 90 }}
                  />
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>筛选模式（可多选）</Text>
                <Select
                  mode="multiple"
                  size="small"
                  value={schedule.modes}
                  onChange={(vals) => updateModes(idx, vals)}
                  disabled={!schedule.enabled}
                  style={{ width: '100%' }}
                  options={MODES.map(m => ({ label: m.label, value: m.key }))}
                  maxTagCount={3}
                />
              </div>
            </div>

            <div className="mt-2">
              <Text type="secondary" style={{ fontSize: 11 }}>
                实际执行时间：每个交易日 {timeValue ? timeValue.format('HH:mm') : '--:--'}（周一~周五）
              </Text>
            </div>
          </div>
        )
      })}
    </Card>
  )
}

// ============ Main Page ============
const RecommendPage = () => {
  const [selectedModes, setSelectedModes] = useState(["oversold_rebound"])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [modeLabels, setModeLabels] = useState(["底部反弹"])
  const [showCron, setShowCron] = useState(false)
  const { addToWatchList, updateQuote } = usePositionStore()

  const toggleMode = (key) => {
    setSelectedModes(prev => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev
        return prev.filter(m => m !== key)
      }
      return [...prev, key]
    })
  }

  const handleRun = async () => {
    if (!selectedModes.length) { message.warning("请至少选择一种筛选模式"); return }
    setLoading(true)
    setResults([])
    try {
      const data = await screenerApi.run(selectedModes, 50)
      setResults(data.results || [])
      setModeLabels(data.modeLabels || [])
      setHasRun(true)
    } catch (e) {
      message.error("筛选失败: " + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAddToWatch = async (stock) => {
    try {
      const quote = await quoteApi.getQuote(stock.code)
      addToWatchList(stock.code)
      updateQuote(stock.code, quote)
      message.success("已添加 " + stock.name + " (" + stock.code + ") 到自选股")
    } catch (e) {
      message.error("添加失败: " + e.message)
    }
  }

  const handleSendReport = async () => {
    if (!results.length) return
    const top3 = results.slice(0, 3).map(s => s.name + "(" + s.code + ") 综合评分" + s.avgScore + " | " + (s.reasons?.[0] || "")).join("\n")
    const modeStr = modeLabels.join("+")
    try {
      await notifyApi.send({
        title: "📊 " + modeStr + "股票筛选",
        content: "筛选条件（多模式交集）：" + modeStr + "\n\n符合条件标的（前3）：\n" + top3 + "\n\n仅供参考，不构成投资建议。"
      })
      message.success("筛选报告已发送至飞书")
    } catch (e) {
      message.error("发送失败: " + e.message)
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 style={{ fontSize: 24, margin: 0 }}>智能选股</h1>
        <Space>
          <Button onClick={() => setShowCron(v => !v)} type={showCron ? "primary" : "default"}>
            <ClockCircleOutlined /> {showCron ? '收起配置' : '定时推送'}
          </Button>
          <Button onClick={handleSendReport} disabled={!results.length}>发送报告</Button>
          <Button type="primary" onClick={handleRun} loading={loading}>开始筛选</Button>
        </Space>
      </div>

      {showCron && <CronConfigPanel />}

      <Card className="mb-3">
        <div className="mb-3">
          <Text type="secondary" style={{ fontSize: 12 }}>选择筛选模式（可多选，同时满足全部条件的股票才会出现）：</Text>
        </div>
        <Row gutter={12}>
          {MODES.map(mode => {
            const checked = selectedModes.includes(mode.key)
            return (
              <Col key={mode.key} span={4}>
                <Card
                  hoverable
                  onClick={() => toggleMode(mode.key)}
                  style={{
                    border: checked ? "2px solid " + mode.color : "1px solid #f0f0f0",
                    cursor: "pointer",
                    background: checked ? mode.color + "08" : "#fff",
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox checked={checked} onChange={() => toggleMode(mode.key)} style={{ marginRight: 4 }} />
                    <span style={{ fontSize: 16, color: mode.color }}>{mode.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{mode.label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#999", lineHeight: 1.4 }}>{mode.desc}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {mode.tags.map(t => <Tag key={t} style={{ fontSize: 10, margin: 0 }}>{t}</Tag>)}
                  </div>
                </Card>
              </Col>
            )
          })}
        </Row>
      </Card>

      {selectedModes.length > 1 && (
        <Alert
          type="info"
          message={"已选 " + selectedModes.length + " 种模式：" + modeLabels.join(" + ") + "，仅显示同时满足全部条件的股票"}
          className="mb-3"
          showIcon
        />
      )}

      {loading && (
        <Card>
          <div className="flex justify-center items-center py-12">
            <Spin tip="正在从热门股票中筛选，请稍候..." size="large" />
          </div>
        </Card>
      )}

      {!loading && !hasRun && (
        <Card>
          <div className="text-center text-gray-400 py-12">
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>🔍</div>
            <div>选择筛选模式后，点击「开始筛选」获取推荐股票</div>
            <div style={{ fontSize: 12, marginTop: 8, color: "#999" }}>多选时仅显示同时满足所有条件的股票（交集）</div>
          </div>
        </Card>
      )}

      {!loading && hasRun && results.length === 0 && (
        <Card><Empty description="当前条件组合未找到符合条件的股票，可尝试减少筛选模式" /></Card>
      )}

      {!loading && results.length > 0 && (
        <>
          <div className="flex justify-between items-center mb-3">
            <Text type="secondary">共 <strong>{results.length}</strong> 只股票符合条件（按综合评分排序）</Text>
          </div>
          <Row gutter={[16, 0]}>
            {results.map(stock => (
              <Col key={stock.code} span={8}>
                <StockCard stock={stock} selectedModes={selectedModes} onAdd={handleAddToWatch} />
              </Col>
            ))}
          </Row>
        </>
      )}
    </div>
  )
}

export default RecommendPage
