import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const DEFAULT_GROUP = { id: 'default', name: '默认分组' }

const usePositionStore = create(persist(
  (set, get) => ({
    // ---- 持仓数据（交易流水式，由 API 实时汇总）----
    positions: [],        // [{ code, name, shares, cost, currentPrice, profit, profitPct, todayProfit, todayProfitPct, positionPct, ... }]
    transactions: [],     // [{ id, code, name, type, price, shares, fee, note, traded_at }]

    // ---- 行情数据 ----
    quotes: {},           // { code: quoteData }
    quotesLoading: false,

    // ---- 自选股分组 ----
    watchList: [],
    watchGroups: [],

    // ---- 加载状态 ----
    loading: false,
    error: null,

    // ---- 迁移：首次把 flat watchList 迁入分组 ----
    _ensureGroups() {
      const state = get()
      if (state.watchGroups && state.watchGroups.length > 0) return
      if (state.watchList && state.watchList.length > 0) {
        set({ watchGroups: [{ ...DEFAULT_GROUP, codes: [...state.watchList] }] })
      } else {
        set({ watchGroups: [{ ...DEFAULT_GROUP }] })
      }
    },

    // ============================================================
    // 持仓管理（交易流水式）
    // ============================================================

    // GET /api/positions — 获取汇总后的持仓列表
    fetchPositions: async (positionApi) => {
      set({ loading: true, error: null })
      try {
        const positions = await positionApi.getAll()
        set({ positions, loading: false })
        return positions
      } catch (error) {
        set({ error: error.message, loading: false })
        throw error
      }
    },

    // GET /api/positions/history — 获取交易流水
    fetchTransactions: async (positionApi, page = 1, pageSize = 50) => {
      set({ loading: true, error: null })
      try {
        const result = await positionApi.getHistory(page, pageSize)
        set({ transactions: result.data || result, loading: false })
        return result
      } catch (error) {
        set({ error: error.message, loading: false })
        throw error
      }
    },

    // GET /api/positions/history/:code — 获取某只股票的交易历史
    fetchStockHistory: async (positionApi, code) => {
      try {
        const history = await positionApi.getHistoryByCode(code)
        return history
      } catch (error) {
        set({ error: error.message })
        throw error
      }
    },

    // POST /api/positions — 录入新交易（买入/卖出）
    addTransaction: async (positionApi, data) => {
      try {
        const tx = await positionApi.create(data)
        // 重新获取最新持仓汇总
        await get().fetchPositions(positionApi)
        return tx
      } catch (error) {
        set({ error: error.message })
        throw error
      }
    },

    // PUT /api/positions/:id — 更新交易备注
    updateTransaction: async (positionApi, id, data) => {
      try {
        const updated = await positionApi.update(id, data)
        return updated
      } catch (error) {
        set({ error: error.message })
        throw error
      }
    },

    // DELETE /api/positions/:id — 删除单笔交易
    deleteTransaction: async (positionApi, id) => {
      try {
        await positionApi.delete(id)
        // 重新获取最新持仓汇总
        await get().fetchPositions(positionApi)
      } catch (error) {
        set({ error: error.message })
        throw error
      }
    },

    // DELETE /api/positions/code/:code — 清空某只股票所有交易（删除持仓）
    deletePositionByCode: async (positionApi, code) => {
      try {
        await positionApi.deleteByCode(code)
        // 重新获取最新持仓汇总
        await get().fetchPositions(positionApi)
      } catch (error) {
        set({ error: error.message })
        throw error
      }
    },

    // ---- 兼容旧版 API（迁移后不再推荐使用）----
    addPosition: async (positionApi, data) => {
      // 将旧版 data 映射为 buy 交易
      return get().addTransaction(positionApi, {
        ...data,
        type: 'buy',
        price: data.cost,
        shares: data.shares,
      })
    },

    updatePosition: async (positionApi, id, data) => {
      return get().updateTransaction(positionApi, id, data)
    },

    deletePosition: async (positionApi, id) => {
      return get().deleteTransaction(positionApi, id)
    },

    // ---- 行情管理 ----
    updateQuote: (code, quote) => {
      set(state => ({ quotes: { ...state.quotes, [code]: quote } }))
    },

    updateQuotes: (quotes) => {
      const quotesMap = {}
      quotes.forEach(q => { if (q && q.code) quotesMap[q.code] = q })
      set(state => ({ quotes: { ...state.quotes, ...quotesMap } }))
    },

    setQuotesLoading: (val) => set({ quotesLoading: val }),

    // ---- 自选股分组管理 ----
    addWatchGroup: (name) => {
      const id = Date.now().toString()
      set(state => ({
        watchGroups: [...(state.watchGroups || []), { id, name, codes: [] }]
      }))
      return id
    },

    deleteWatchGroup: (id) => {
      set(state => {
        const groups = (state.watchGroups || []).filter(g => g.id !== id)
        return { watchGroups: groups.length ? groups : [{ ...DEFAULT_GROUP }] }
      })
    },

    renameWatchGroup: (id, name) => {
      set(state => ({
        watchGroups: (state.watchGroups || []).map(g => g.id === id ? { ...g, name } : g)
      }))
    },

    addToWatchList: (code, groupId) => {
      set(state => {
        const groups = state.watchGroups?.length ? [...state.watchGroups] : [{ ...DEFAULT_GROUP }]
        const targetIdx = groupId
          ? groups.findIndex(g => g.id === groupId)
          : groups.findIndex(g => g.id === 'default') ?? 0
        const idx = targetIdx >= 0 ? targetIdx : 0
        if (groups[idx].codes.includes(code)) return state
        groups[idx] = { ...groups[idx], codes: [...groups[idx].codes, code] }
        return { watchGroups: groups }
      })
    },

    removeFromWatchList: (code, groupId) => {
      set(state => {
        const groups = state.watchGroups ? [...state.watchGroups] : [{ ...DEFAULT_GROUP }]
        if (groupId) {
          const idx = groups.findIndex(g => g.id === groupId)
          if (idx >= 0) groups[idx] = { ...groups[idx], codes: groups[idx].codes.filter(c => c !== code) }
        } else {
          groups.forEach(g => { g.codes = g.codes.filter(c => c !== code) })
        }
        if (groups.length > 1) {
          const filtered = groups.filter(g => g.codes.length > 0 || g.id === 'default')
          return {
            watchGroups: filtered.length ? filtered : [{ ...DEFAULT_GROUP }],
            quotes: Object.fromEntries(Object.entries(state.quotes).filter(([k]) => !groups.some(g => g.codes.includes(k))))
          }
        }
        return {
          watchGroups: groups,
          quotes: Object.fromEntries(Object.entries(state.quotes).filter(([k]) => !groups.some(g => g.codes.includes(k))))
        }
      })
    },

    moveStockToGroup: (code, fromGroupId, toGroupId) => {
      set(state => {
        const groups = [...(state.watchGroups || [{ ...DEFAULT_GROUP }])]
        const fromIdx = groups.findIndex(g => g.id === fromGroupId)
        const toIdx = groups.findIndex(g => g.id === toGroupId)
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return state
        groups[fromIdx] = { ...groups[fromIdx], codes: groups[fromIdx].codes.filter(c => c !== code) }
        if (!groups[toIdx].codes.includes(code)) groups[toIdx] = { ...groups[toIdx], codes: [...groups[toIdx].codes, code] }
        return { watchGroups: groups }
      })
    },

    getWatchList: () => {
      const state = get()
      return (state.watchGroups || []).flatMap(g => g.codes)
    },

    getAllCodesInGroup: (groupId) => {
      const state = get()
      const group = (state.watchGroups || []).find(g => g.id === groupId)
      return group ? group.codes : []
    },
  }),
  {
    name: 'stock-dashboard-storage',
    partialize: (state) => ({
      positions: Array.isArray(state.positions) ? state.positions : [],
      quotes: state.quotes || {},
      watchList: Array.isArray(state.watchList) ? state.watchList : [],
      watchGroups: state.watchGroups || [],
    })
  }
))

export default usePositionStore
