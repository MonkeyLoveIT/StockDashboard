import React, { useEffect, useState, useRef } from 'react'
import { Table, Input, Button, Card, message, Space, Modal, Form, Tag, Typography, Badge, Collapse } from 'antd'
import { PlusOutlined, ReloadOutlined, DeleteOutlined, TeamOutlined, EditOutlined, MenuFoldOutlined, MenuUnfoldOutlined, RightOutlined, DownOutlined } from '@ant-design/icons'
import { searchApi, quoteApi } from '../services/api'
import usePositionStore from '../stores/useStore'

const { Text } = Typography

// 涨跌幅颜色
const getPriceColor = (v) => v > 0 ? '#e24a4a' : v < 0 ? '#52c41a' : '#999'
const fmtPct = (v) => v > 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`
const fmtAmt = (v) => {
  if (!v) return '-'
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万'
  return v.toFixed(2)
}

// 单个分组表格
const GroupTable = ({ group, quotes, onRemove, onMoveTo, allGroups, currentGroupId }) => {
  const [loading, setLoading] = useState(false)

  const refresh = async (codes) => {
    if (!codes.length) return
    setLoading(true)
    try {
      const list = await quoteApi.getQuotes(codes)
      usePositionStore.getState().updateQuotes(list)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { title: '代码', dataIndex: 'code', key: 'code', width: 90 },
    {
      title: '名称', dataIndex: 'name', key: 'name', width: 100,
      render: (_, r) => quotes[r.code]?.name || r.code
    },
    {
      title: '最新价', dataIndex: 'price', key: 'price', width: 90,
      render: (_, r) => {
        const q = quotes[r.code]
        if (!q || q.error) return '-'
        return <Text strong>¥{q.price.toFixed(2)}</Text>
      }
    },
    {
      title: '涨跌幅', dataIndex: 'changePct', key: 'changePct', width: 100,
      render: (_, r) => {
        const q = quotes[r.code]
        if (!q || q.error) return '-'
        return <Text style={{ color: getPriceColor(q.changePct), fontWeight: 600 }}>{fmtPct(q.changePct)}</Text>
      }
    },
    { title: '今开', dataIndex: 'open', key: 'open', width: 75, render: (_, r) => quotes[r.code]?.open?.toFixed(2) || '-' },
    { title: '最高', dataIndex: 'high', key: 'high', width: 75, render: (_, r) => quotes[r.code]?.high?.toFixed(2) || '-' },
    { title: '最低', dataIndex: 'low', key: 'low', width: 75, render: (_, r) => quotes[r.code]?.low?.toFixed(2) || '-' },
    { title: '成交额', dataIndex: 'amount', key: 'amount', width: 90, render: (_, r) => fmtAmt(quotes[r.code]?.amount) },
    {
      title: '操作', key: 'action', width: 120,
      render: (_, r) => {
        const otherGroups = allGroups.filter(g => g.id !== currentGroupId)
        return (
          <Space size={4}>
            {otherGroups.length > 0 && (
              <select
                style={{ fontSize: 11, padding: '2px 4px', borderRadius: 4, border: '1px solid #d9d9d9', cursor: 'pointer' }}
                onChange={e => { if (e.target.value) { onMoveTo(r.code, currentGroupId, e.target.value); e.target.value = '' } }}
              >
                <option value="">移动</option>
                {otherGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            <Button type="link" danger size="small" onClick={() => onRemove(r.code)} style={{ padding: '2px 4px' }}>移除</Button>
          </Space>
        )
      }
    }
  ]

  const dataSource = group.codes.map(code => ({ code, key: code }))

  return (
    <Table
      columns={columns}
      dataSource={dataSource}
      rowKey="code"
      loading={loading}
      size="small"
      pagination={false}
      footer={() => (
        <div style={{ textAlign: 'right' }}>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => refresh(group.codes)}>
            刷新
          </Button>
        </div>
      )}
    />
  )
}

// 自选股页面
const QuoteTable = () => {
  const {
    quotes, watchGroups, addToWatchList, removeFromWatchList, moveStockToGroup,
    addWatchGroup, deleteWatchGroup, renameWatchGroup, updateQuotes, _ensureGroups
  } = usePositionStore()

  const [activeGroups, setActiveGroups] = useState(['default'])
  const [searchCode, setSearchCode] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [renameModalVisible, setRenameModalVisible] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [form] = Form.useForm()
  const [renameForm] = Form.useForm()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const hasInitiallyFetched = useRef(false)

  // 初始化分组
  useEffect(() => { _ensureGroups() }, [])

  // 首次加载静默刷新
  useEffect(() => {
    if (hasInitiallyFetched.current) return
    if (!watchGroups.length) return
    hasInitiallyFetched.current = true
    const allCodes = watchGroups.flatMap(g => g.codes)
    if (!allCodes.length) return
    quoteApi.getQuotes(allCodes).then(list => updateQuotes(list)).catch(() => {})
  }, [watchGroups])

  // 计算分组平均涨跌
  const groupAvg = (group) => {
    const valid = group.codes.map(c => quotes[c]).filter(q => q && !q.error && q.changePct != null)
    if (!valid.length) return null
    return valid.reduce((s, q) => s + q.changePct, 0) / valid.length
  }

  // 搜索
  const handleSearch = async () => {
    if (!searchCode.trim()) { message.warning('请输入股票代码或名称'); return }
    setSearchLoading(true)
    try {
      const data = await searchApi.search(searchCode)
      setSearchResults(data.results || [])
    } catch (e) {
      message.error('搜索失败: ' + e.message)
    } finally {
      setSearchLoading(false)
    }
  }

  // 添加到指定分组
  const handleAddToGroup = async (stock, groupId) => {
    const group = watchGroups.find(g => g.id === groupId) || watchGroups[0]
    if (!group) { message.error('请先创建分组'); return }
    if (group.codes.includes(stock.code)) { message.info('已在该分组中'); return }
    try {
      const quote = await quoteApi.getQuote(stock.code)
      addToWatchList(stock.code, group.id)
      usePositionStore.getState().updateQuote(stock.code, quote)
      message.success(`已添加 ${stock.name} 到「${group.name}」`)
      setSearchResults([])
      setSearchCode('')
    } catch (e) {
      message.error('添加失败: ' + e.message)
    }
  }

  // 刷新全部
  const refreshAll = async () => {
    const allCodes = watchGroups.flatMap(g => g.codes)
    if (!allCodes.length) return
    try {
      const list = await quoteApi.getQuotes(allCodes)
      updateQuotes(list)
      message.success('全部刷新成功')
    } catch (e) {
      message.error('刷新失败: ' + e.message)
    }
  }

  // 新建分组
  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      if (watchGroups.some(g => g.name === values.name)) { message.warning('分组名已存在'); return }
      const id = addWatchGroup(values.name)
      setActiveGroups(prev => [...prev, id])
      setCreateModalVisible(false)
      form.resetFields()
      message.success('分组已创建')
    } catch (e) { if (e.errorFields) return }
  }

  // 重命名
  const handleRename = async () => {
    try {
      const values = await renameForm.validateFields()
      if (watchGroups.some(g => g.id !== editingGroup?.id && g.name === values.name)) { message.warning('分组名已存在'); return }
      renameWatchGroup(editingGroup.id, values.name)
      setRenameModalVisible(false)
      message.success('分组已重命名')
    } catch (e) { if (e.errorFields) return }
  }

  const openRename = (group) => {
    setEditingGroup(group)
    renameForm.setFieldsValue({ name: group.name })
    setRenameModalVisible(true)
  }

  const toggleGroup = (groupId) => {
    setActiveGroups(prev =>
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    )
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', overflow: 'hidden' }}>
      {/* ====== 侧边栏 ====== */}
      <div style={{
        width: sidebarCollapsed ? 48 : 220,
        borderRight: '1px solid #f0f0f0',
        background: '#fafafa',
        transition: 'width 0.2s',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0
      }}>
        {/* 侧边栏头部 */}
        <div style={{ padding: '12px 8px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between' }}>
          {!sidebarCollapsed && <span style={{ fontWeight: 600, fontSize: 13 }}>分组</span>}
          <Button type="text" size="small" icon={sidebarCollapsed ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={() => setSidebarCollapsed(c => !c)} style={{ flexShrink: 0 }} />
        </div>

        {/* 分组列表 */}
        {!sidebarCollapsed && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 4px' }}>
            {watchGroups.map(group => {
              const avg = groupAvg(group)
              const isActive = activeGroups.includes(group.id)
              return (
                <div
                  key={group.id}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    marginBottom: 4,
                    cursor: 'pointer',
                    background: isActive ? '#e6f4ff' : 'transparent',
                    border: isActive ? '1px solid #91caff' : '1px solid transparent',
                  }}
                  onClick={() => toggleGroup(group.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isActive ? <DownOutlined style={{ fontSize: 10, color: '#1677ff' }} /> : <RightOutlined style={{ fontSize: 10, color: '#999' }} />}
                      <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400 }}>{group.name}</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#999' }}>{group.codes.length}</span>
                  </div>
                  {avg != null && (
                    <div style={{ marginLeft: 18, fontSize: 11, color: getPriceColor(avg) }}>
                      {avg >= 0 ? '↑' : '↓'} {fmtPct(avg)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 侧边栏底部：新建分组 */}
        {!sidebarCollapsed && (
          <div style={{ padding: '8px 10px', borderTop: '1px solid #e8e8e8' }}>
            <Button size="small" icon={<PlusOutlined />} block onClick={() => setCreateModalVisible(true)} style={{ fontSize: 12 }}>
              新建分组
            </Button>
          </div>
        )}
      </div>

      {/* ====== 主内容区 ====== */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
        {/* 搜索 */}
        <Card className="mb-3" size="small">
          <Space>
            <Input
              placeholder="输入股票代码或名称搜索"
              value={searchCode}
              onChange={e => setSearchCode(e.target.value)}
              onPressEnter={handleSearch}
              style={{ width: 220 }}
            />
            <Button type="primary" onClick={handleSearch} loading={searchLoading}>搜索</Button>
            <Button onClick={refreshAll}>刷新全部</Button>
          </Space>

          {searchResults.length > 0 && (
            <div className="mt-3 p-3" style={{ background: '#f5f5f5', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>搜索结果（点击分组添加）：</div>
              {searchResults.map(stock => (
                <div key={stock.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
                  <span style={{ fontSize: 13 }}>{stock.name} ({stock.code})</span>
                  <Space size={4}>
                    {watchGroups.map(g => (
                      <Button key={g.id} size="small" onClick={() => handleAddToGroup(stock, g.id)}>+ {g.name}</Button>
                    ))}
                  </Space>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 展开的分组内容 */}
        {activeGroups.length === 0 && (
          <Card><div style={{ textAlign: 'center', color: '#999', padding: 40 }}>从左侧侧边栏点击分组名称展开查看</div></Card>
        )}

        {activeGroups.map(groupId => {
          const group = watchGroups.find(g => g.id === groupId)
          if (!group) return null
          const avg = groupAvg(group)

          return (
            <Card
              key={group.id}
              className="mb-3"
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TeamOutlined />
                  <span style={{ fontWeight: 600 }}>{group.name}</span>
                  <Tag>{group.codes.length}只</Tag>
                  {avg != null && (
                    <Tag color={avg >= 0 ? 'red' : 'green'}>
                      均 {avg >= 0 ? '+' : ''}{avg.toFixed(2)}%
                    </Tag>
                  )}
                  {group.id !== 'default' && (
                    <Space size={4} style={{ marginLeft: 'auto' }}>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openRename(group)} />
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => {
                        setActiveGroups(prev => prev.filter(id => id !== groupId))
                        deleteWatchGroup(group.id)
                        message.success('已删除')
                      }} />
                    </Space>
                  )}
                </div>
              }
            >
              {group.codes.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#999', padding: '20px 0' }}>
                  搜索股票后点击「+ 分组名」添加到此处
                </div>
              ) : (
                <GroupTable
                  group={group}
                  quotes={quotes}
                  onRemove={(code) => { removeFromWatchList(code, group.id); message.success('已移除') }}
                  onMoveTo={(code, fromId, toId) => moveStockToGroup(code, fromId, toId)}
                  allGroups={watchGroups}
                  currentGroupId={group.id}
                />
              )}
            </Card>
          )
        })}
      </div>

      {/* 新建分组弹窗 */}
      <Modal title="新建分组" open={createModalVisible} onOk={handleCreate}
        onCancel={() => { setCreateModalVisible(false); form.resetFields() }} okText="创建">
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="分组名称" rules={[{ required: true, message: '请输入分组名称' }]}>
            <Input placeholder="如：新能源、半导体" maxLength={20} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 重命名弹窗 */}
      <Modal title="重命名分组" open={renameModalVisible} onOk={handleRename}
        onCancel={() => setRenameModalVisible(false)} okText="确定">
        <Form form={renameForm} layout="vertical">
          <Form.Item name="name" label="新名称" rules={[{ required: true, message: '请输入新名称' }]}>
            <Input placeholder="输入新分组名称" maxLength={20} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default QuoteTable
