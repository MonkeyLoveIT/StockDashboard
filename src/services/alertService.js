import { notifyApi } from './api'

const ALERT_STORAGE_KEY = 'stock_alerts'

// 加载提醒列表
export const loadAlerts = () => {
  try {
    const raw = localStorage.getItem(ALERT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

// 保存提醒列表
export const saveAlerts = (alerts) => {
  localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alerts))
}

// 提醒配置结构
// { id, code, name, type: 'above'|'below'|'signal', value, enabled, triggered, createdAt }

// 添加提醒
export const addAlert = (alert) => {
  const alerts = loadAlerts()
  const newAlert = {
    ...alert,
    id: Date.now().toString(),
    triggered: false,
    createdAt: new Date().toISOString()
  }
  alerts.push(newAlert)
  saveAlerts(alerts)
  return newAlert
}

// 删除提醒
export const removeAlert = (id) => {
  const alerts = loadAlerts().filter(a => a.id !== id)
  saveAlerts(alerts)
}

// 切换提醒启用状态
export const toggleAlert = (id) => {
  const alerts = loadAlerts()
  const idx = alerts.findIndex(a => a.id === id)
  if (idx !== -1) {
    alerts[idx].enabled = !alerts[idx].enabled
    saveAlerts(alerts)
  }
}

// 重置触发状态
export const resetAlert = (id) => {
  const alerts = loadAlerts()
  const idx = alerts.findIndex(a => a.id === id)
  if (idx !== -1) {
    alerts[idx].triggered = false
    saveAlerts(alerts)
  }
}

// 检查到价提醒是否触发
export const checkPriceAlerts = (quotes, alerts) => {
  const priceAlerts = alerts.filter(a => a.type === 'above' || a.type === 'below')
  const triggered = []

  for (const alert of priceAlerts) {
    if (!alert.enabled || alert.triggered) continue
    const quote = quotes[alert.code]
    if (!quote || quote.error) continue

    const price = quote.price
    const target = parseFloat(alert.value)

    let isTriggered = false
    if (alert.type === 'above' && price >= target) isTriggered = true
    if (alert.type === 'below' && price <= target) isTriggered = true

    if (isTriggered) {
      triggered.push({ alert, price })
      // 标记已触发
      const all = loadAlerts()
      const idx = all.findIndex(a => a.id === alert.id)
      if (idx !== -1) { all[idx].triggered = true; saveAlerts(all) }
    }
  }

  return triggered
}

// 检查策略信号提醒
export const checkSignalAlerts = (signals, alerts) => {
  const signalAlerts = alerts.filter(a => a.type === 'signal' && a.enabled && !a.triggered)
  const triggered = []

  for (const alert of signalAlerts) {
    const signal = signals[alert.code]
    if (!signal) continue

    let isTriggered = false
    if (alert.value === 'ma_gold' && signal.maGoldCross) isTriggered = true
    if (alert.value === 'ma_death' && signal.maDeathCross) isTriggered = true
    if (alert.value === 'kdj_gold' && signal.kdjGoldCross) isTriggered = true
    if (alert.value === 'kdj_death' && signal.kdjDeathCross) isTriggered = true
    if (alert.value === 'macd_cross_up' && signal.macdCrossUp) isTriggered = true
    if (alert.value === 'macd_cross_down' && signal.macdCrossDown) isTriggered = true

    if (isTriggered) {
      triggered.push({ alert, signal })
      const all = loadAlerts()
      const idx = all.findIndex(a => a.id === alert.id)
      if (idx !== -1) { all[idx].triggered = true; saveAlerts(all) }
    }
  }

  return triggered
}

// 发送飞书提醒通知
export const sendAlertNotifications = async (triggeredItems) => {
  for (const { alert, price, signal } of triggeredItems) {
    let title = ''
    let content = ''

    if (alert.type === 'above') {
      title = `📈 到价提醒：${alert.name || alert.code}`
      content = `当前价 ¥${price?.toFixed(2)} 已达到您的提醒价 ¥${alert.value}（上涨提醒）`
    } else if (alert.type === 'below') {
      title = `📉 到价提醒：${alert.name || alert.code}`
      content = `当前价 ¥${price?.toFixed(2)} 已跌破您的提醒价 ¥${alert.value}（下跌提醒）`
    } else if (alert.type === 'signal') {
      const signalLabels = {
        ma_gold: 'MA均线金叉',
        ma_death: 'MA均线死叉',
        kdj_gold: 'KDJ金叉',
        kdj_death: 'KDJ死叉',
        macd_cross_up: 'MACD水上金叉',
        macd_cross_down: 'MACD水下死叉'
      }
      title = `📋 策略信号：${alert.name || alert.code}`
      content = `触发信号：${signalLabels[alert.value] || alert.value}`
    }

    try {
      await notifyApi.send({ title, content })
    } catch (e) {
      console.error('发送飞书提醒失败:', e)
    }
  }
}
