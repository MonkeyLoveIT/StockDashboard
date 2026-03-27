import React from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import Dashboard from './pages/Dashboard'
import Positions from './pages/Positions'
import QuoteTable from './pages/QuoteTable'
import KlineChart from './pages/KlineChart'
import TacticPage from './pages/TacticPage'
import RecommendPage from './pages/RecommendPage'
import AlertsPage from './pages/AlertsPage'
import BacktestPage from './pages/BacktestPage'

const { Header, Content } = Layout

const items = [
  { key: '/', label: <Link to="/">Dashboard</Link> },
  { key: '/positions', label: <Link to="/positions">Positions</Link> },
  { key: '/quotes', label: <Link to="/quotes">Quotes</Link> },
  { key: '/kline', label: <Link to="/kline">K-Line</Link> },
  { key: '/tactics', label: <Link to="/tactics">做T推荐</Link> },
  { key: '/alerts', label: <Link to="/alerts">价格提醒</Link> },
  { key: '/backtest', label: <Link to="/backtest">策略回测</Link> },
  { key: '/recommend', label: <Link to="/recommend">股票推荐</Link> }
]

function App() {
  return (
    <BrowserRouter>
      <Layout className="min-h-screen">
        <Header style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ color: 'white', fontSize: 20, marginRight: 40, fontWeight: 'bold' }}>
            Stock Dashboard
          </div>
          <Menu theme="dark" mode="horizontal" items={items} style={{ flex: 1 }} />
        </Header>
        <Content style={{ padding: '24px 50px' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/positions" element={<Positions />} />
            <Route path="/quotes" element={<QuoteTable />} />
            <Route path="/kline" element={<KlineChart />} />
            <Route path="/tactics" element={<TacticPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/backtest" element={<BacktestPage />} />
            <Route path="/recommend" element={<RecommendPage />} />
          </Routes>
        </Content>
      </Layout>
    </BrowserRouter>
  )
}

export default App
