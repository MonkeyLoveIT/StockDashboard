import React, { useEffect, useState, useRef } from 'react'
import { Table, Input, Button, Card, message, Space } from 'antd'
import { searchApi, quoteApi } from '../services/api'
import usePositionStore from '../stores/useStore'

// 涨跌幅颜色
const getPriceColor = (value) => value > 0 ? 'red-text' : value < 0 ? 'green-text' : ''

const QuoteTable = () => {
  const { watchList, quotes, addToWatchList, removeFromWatchList, updateQuote, updateQuotes } = usePositionStore()
  const [searchCode, setSearchCode] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const hasInitiallyFetched = useRef(false)

  // 页面首次加载时：静默刷新一次行情（不弹成功）
  useEffect(() => {
    if (hasInitiallyFetched.current) return
    if (watchList.length === 0) {
      hasInitiallyFetched.current = true
      return
    }
    hasInitiallyFetched.current = true

    const initRefresh = async () => {
      try {
        const quotesList = await quoteApi.getQuotes(watchList)
        updateQuotes(quotesList)
      } catch (e) {
        console.error('init refresh failed:', e)
      }
    }
    initRefresh()
  }, []) // 仅首次挂载时执行

  // 搜索股票
  const handleSearch = async () => {
    if (!searchCode.trim()) {
      message.warning('请输入股票代码或名称')
      return
    }

    setSearchLoading(true)
    try {
      const data = await searchApi.search(searchCode)
      setSearchResults(data.results || [])
    } catch (error) {
      message.error('搜索失败: ' + error.message)
    } finally {
      setSearchLoading(false)
    }
  }

  // 添加到自选
  const handleAddToWatchList = async (stock) => {
    if (watchList.includes(stock.code)) {
      message.info('已在自选列表中')
      return
    }

    try {
      const quote = await quoteApi.getQuote(stock.code)
      addToWatchList(stock.code)
      updateQuote(stock.code, quote)
      message.success(`已添加 ${stock.name} (${stock.code}) 到自选`)
      setSearchResults([])
      setSearchCode('')
    } catch (error) {
      message.error('添加失败: ' + error.message)
    }
  }

  // 刷新单个行情
  const refreshQuote = async (code) => {
    try {
      const quote = await quoteApi.getQuote(code)
      updateQuote(code, quote)
    } catch (error) {
      console.error('Failed to refresh:', error)
    }
  }

  // 刷新全部
  const refreshAll = async () => {
    if (watchList.length === 0) return

    setLoading(true)
    try {
      const quotesList = await quoteApi.getQuotes(watchList)
      updateQuotes(quotesList)
      message.success('刷新成功')
    } catch (error) {
      message.error('刷新失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // 移除自选
  const handleRemove = (code) => {
    removeFromWatchList(code)
  }

  // 表格列定义
  const columns = [
    { title: '代码', dataIndex: 'code', key: 'code', width: 100 },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 120,
      render: (_, record) => {
        const quote = quotes[record.code]
        return quote?.name || record.name || record.code
      }
    },
    {
      title: '最新价',
      dataIndex: 'price',
      key: 'price',
      width: 100,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote || quote.error) return '-'
        return `¥${quote.price.toFixed(2)}`
      }
    },
    {
      title: '涨跌幅',
      dataIndex: 'changePct',
      key: 'changePct',
      width: 100,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote || quote.error) return '-'
        return (
          <span className={getPriceColor(quote.changePct)}>
            {quote.changePct > 0 ? '+' : ''}{quote.changePct.toFixed(2)}%
          </span>
        )
      }
    },
    {
      title: '涨跌额',
      dataIndex: 'change',
      key: 'change',
      width: 100,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote || quote.error) return '-'
        return (
          <span className={getPriceColor(quote.change)}>
            {quote.change > 0 ? '+' : ''}{quote.change.toFixed(2)}
          </span>
        )
      }
    },
    {
      title: '今开',
      dataIndex: 'open',
      key: 'open',
      width: 80,
      render: (_, record) => {
        const quote = quotes[record.code]
        return quote?.open?.toFixed(2) || '-'
      }
    },
    {
      title: '最高',
      dataIndex: 'high',
      key: 'high',
      width: 80,
      render: (_, record) => {
        const quote = quotes[record.code]
        return quote?.high?.toFixed(2) || '-'
      }
    },
    {
      title: '最低',
      dataIndex: 'low',
      key: 'low',
      width: 80,
      render: (_, record) => {
        const quote = quotes[record.code]
        return quote?.low?.toFixed(2) || '-'
      }
    },
    {
      title: '成交量',
      dataIndex: 'volume',
      key: 'volume',
      width: 120,
      render: (_, record) => {
        const quote = quotes[record.code]
        if (!quote?.volume) return '-'
        const vol = quote.volume
        if (vol >= 100000000) return (vol / 100000000).toFixed(2) + '亿'
        if (vol >= 10000) return (vol / 10000).toFixed(2) + '万'
        return vol.toString()
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, record) => (
        <Button type="link" danger size="small" onClick={() => handleRemove(record.code)}>
          移除
        </Button>
      )
    }
  ]

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>实时行情</h1>

      {/* 搜索区域 */}
      <Card className="mb-4">
        <Space>
          <Input
            placeholder="输入股票代码或名称搜索"
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 200 }}
          />
          <Button type="primary" onClick={handleSearch} loading={searchLoading}>搜索</Button>
        </Space>

        {/* 搜索结果 */}
        {searchResults.length > 0 && (
          <div className="mt-4 p-4 bg-gray-50 rounded">
            <div className="text-sm text-gray-500 mb-2">搜索结果:</div>
            {searchResults.map(stock => (
              <div key={stock.code} className="flex justify-between items-center py-1">
                <span>
                  {stock.name} ({stock.code}) - {stock.market}
                </span>
                <Button type="link" size="small" onClick={() => handleAddToWatchList(stock)}>
                  + 添加
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 自选列表 */}
      <Card
        title={`自选股 (${watchList.length})`}
        extra={
          <Space>
            <Button onClick={refreshAll} loading={loading}>刷新全部</Button>
          </Space>
        }
      >
        {watchList.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            暂无自选股，搜索并添加股票到列表
          </div>
        ) : (
          <Table
            columns={columns}
            dataSource={watchList.map(code => ({ code, key: code }))}
            rowKey="code"
            loading={loading}
            pagination={false}
          />
        )}
      </Card>
    </div>
  )
}

export default QuoteTable
