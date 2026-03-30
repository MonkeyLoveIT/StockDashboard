# Stock Dashboard 项目说明

## 项目概述

股票分析管理台，支持实时行情、选股策略、持仓管理、模拟实盘交易。

**技术栈：**
- 前端：React 18 + Vite + Ant Design 5 + Zustand + Tailwind CSS
- 后端：Express（Node.js ESM）
- 数据库：SQLite（本地文件 `stock.db`）
- 实时行情：新浪财经 API（免费）

---

## 目录结构

```
stock-dashboard/
├── src/                      # 前端 React 应用
│   ├── pages/                # 页面组件
│   │   ├── Dashboard.jsx     # 大盘概览
│   │   ├── Positions.jsx     # 真实持仓（交易流水）
│   │   ├── QuoteTable.jsx   # 实时行情表
│   │   ├── KlineChart.jsx   # K 线图
│   │   ├── TacticPage.jsx   # 做 T 推荐
│   │   ├── AlertsPage.jsx  # 价格提醒
│   │   ├── BacktestPage.jsx# 策略回测
│   │   ├── RecommendPage.jsx# 智能选股（含定时推送配置）
│   │   └── PaperTrading.jsx # 模拟实盘
│   ├── services/api.js       # API 调用封装
│   └── stores/useStore.js   # Zustand 状态管理
│
├── server/                    # 后端 Express 服务
│   ├── index.js              # 服务入口，端口 3001
│   ├── db.js                 # SQLite 初始化、表结构、CRUD
│   ├── cron.js               # 定时调度器（智能选股定时推送）
│   ├── paperEngine.js        # 模拟实盘引擎（量化交易）
│   ├── proxy.js              # 飞书 API 代理（bot 推送）
│   ├── routes/               # API 路由
│   │   ├── positions.js      # 持仓 API
│   │   ├── quote.js         # 行情 API
│   │   ├── screener.js      # 选股筛选 API
│   │   ├── notify.js         # 飞书通知 API
│   │   ├── paper.js          # 模拟实盘 API
│   │   ├── cronConfig.js     # 定时任务配置 API
│   │   └── ...
│   └── stock.db              # SQLite 数据库文件
│
└── package.json               # 根目录仅含 concurrently 脚本
```

---

## 数据库表结构

### transactions（真实持仓交易流水）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| code | TEXT | 股票代码 |
| name | TEXT | 股票名称 |
| type | TEXT | buy / sell |
| price | REAL | 成交价格 |
| shares | INTEGER | 成交数量 |
| fee | REAL | 手续费 |
| note | TEXT | 备注（加仓/止损等） |
| traded_at | DATETIME | 成交时间 |

### paper_orders（模拟实盘成交记录）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| code / name | TEXT | 股票代码/名称 |
| type | TEXT | buy / sell / stop_loss / take_profit |
| price | REAL | 成交价格 |
| shares | INTEGER | 成交数量 |
| amount | REAL | 成交金额 |
| reason | TEXT | 触发原因 |
| strategy | TEXT | 触发策略 |
| signal_score | INTEGER | 信号评分 |
| order_at | DATETIME | 成交时间 |

### paper_config（模拟实盘风控参数）
键值对存储，key/value 均为 TEXT。

### paper_daily（模拟实盘每日净值快照）
| 字段 | 类型 | 说明 |
|------|------|------|
| date | TEXT | 日期（YYYY-MM-DD）主键 |
| total_value | REAL | 总资产 |
| cash | REAL | 可用资金 |
| market_value | REAL | 持仓市值 |
| total_profit | REAL | 总盈亏金额 |
| positions_count | INTEGER | 持仓数量 |

### meta（系统元数据）
存储迁移状态等内部信息。

---

## 核心 API

### 真实持仓
```
GET    /api/positions           实时持仓汇总（由 transactions 计算）
POST   /api/positions           新增交易（买入/卖出）
DELETE /api/positions/:id       删除单笔交易
GET    /api/positions/history   全量交易流水
```

### 模拟实盘
```
GET    /api/paper/config        风控参数
PATCH  /api/paper/config        更新风控参数
GET    /api/paper/positions     虚拟持仓
GET    /api/paper/orders       虚拟成交记录
GET    /api/paper/summary      账户总览
POST   /api/paper/reset        重置模拟账户
POST   /api/paper/daily        记录每日净值
GET    /api/paper/equity_curve 获取历史净值曲线
```

### 选股与行情
```
GET    /api/screener/run?mode=oversold_rebound  股票筛选
GET    /api/quote/:code        单只股票实时行情
GET    /api/quote/batch?codes=  批量行情
GET    /api/notify/notify       发送飞书消息
```

---

## 定时任务

### 智能选股定时推送（cron.js）
- 盘前简报：周一~周五 08:55
- 午盘总结：周一~周五 12:35
- 收盘复盘：周一~周五 15:15

### 模拟实盘引擎（paperEngine.js）
- 盘中扫描：周一~周五 9:35~14:55 每 5 分钟一次
- 收盘执行：周一~周五 15:20

---

## 风控参数说明（paper_config）

| Key | 默认值 | 说明 |
|-----|--------|------|
| initial_cash | 100000 | 初始虚拟资金（元） |
| max_position_pct | 20 | 单股仓位上限（%） |
| stop_loss_pct | -5 | 止损比例（%） |
| take_profit_pct | 15 | 止盈比例（%） |
| max_positions | 8 | 最大同时持仓数 |
| buy_ratio | 50 | 每次买入资金比例（%） |
| max_consecutive_losses | 3 | 连续亏损次数上限（超限暂停新买入信号） |
| strategy_xxx | 1 | 各策略开关（0/1） |

**T+1 规则**：当日买入的股票，当日不允许卖出（止损/止盈均屏蔽），下一交易日才可操作。

**连续亏损限制**：当最近卖出（止损/止盈/卖出）亏损次数达到上限时，暂停新买入信号，仅执行止损/止盈。

**净值曲线**：`paperEngine.js` 在每次盘中操作后及收盘后自动记录每日净值快照，前端 `PaperTrading.jsx` 通过 ECharts 展示历史净值曲线。

**飞书卡片化**：所有模拟实盘通知（买入信号/止损/止盈/风控暂停/收盘报告）均通过飞书消息卡片格式推送，提升可读性。

---

## 开发命令

```bash
cd ~/stock-dashboard
npm run dev          # 同时启动前端(5173) + 后端(3001)
cd server && node index.js   # 仅启动后端
cd src && npm run dev        # 仅启动前端
```

---

## 注意事项

### 敏感信息
- 飞书 Bot App ID / Secret 在 `server/routes/notify.js` 顶部硬编码
- `.env` 文件（若有）包含 API Key，不要提交到 Git

### 数据库迁移
- `initDb()` 在每次服务启动时运行
- 使用 `serialize()` 确保建表完成后才执行迁移
- 迁移状态记录在 `meta` 表，已迁移 `migrated=1` 后不再重复执行

### 前端代理
- Vite 开发服务器（5173）代理 `/api` 到 `localhost:3001`
- 生产环境需自行配置 Nginx 反向代理

### Git 提交规则
- 所有代码改动需经 Damon 验证后再提交，**不要自作主张顺手提交**
- `stock.db` 和 `server/stock.db` 已加入 `.gitignore`
