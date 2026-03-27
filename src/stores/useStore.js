import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const DEFAULT_GROUP = { id: 'default', name: '默认分组' }

const usePositionStore = create(persist(
  (set, get) => ({
    positions: [],
    quotes: {},     // { code: quoteData }
    watchList: [],   // 兼容旧版 flat list（首次启动后迁移）
    watchGroups: [], // [{ id, name, codes: string[] }]

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

    // ---- 持仓管理 ----
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

    addPosition: async (positionApi, data) => {
      try {
        const newPosition = await positionApi.create(data)
        set(state => ({ positions: [newPosition, ...state.positions] }))
        return newPosition
      } catch (error) {
        set({ error: error.message })
        throw error
      }
    },

    updatePosition: async (positionApi, id, data) => {
      try {
        const updated = await positionApi.update(id, data)
        set(state => ({
          positions: state.positions.map(p => p.id === id ? updated : p)
        }))
        return updated
      } catch (error) {
        set({ error: error.message })
        throw error
      }
    },

    deletePosition: async (positionApi, id) => {
      try {
        await positionApi.delete(id)
        set(state => ({ positions: state.positions.filter(p => p.id !== id) }))
      } catch (error) {
        set({ error: error.message })
        throw error
      }
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

    // ---- 分组管理 ----
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

    // code 加入指定分组（默认加入第一个分组）
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
          // 从所有分组移除
          groups.forEach(g => { g.codes = g.codes.filter(c => c !== code) })
        }
        // 清理无股票的分组（保留至少默认分组）
        if (groups.length > 1) {
          const filtered = groups.filter(g => g.codes.length > 0 || g.id === 'default')
          return { watchGroups: filtered.length ? filtered : [{ ...DEFAULT_GROUP }], quotes: Object.fromEntries(Object.entries(state.quotes).filter(([k]) => !groups.some(g => g.codes.includes(k)))) }
        }
        return {
          watchGroups: groups,
          quotes: Object.fromEntries(Object.entries(state.quotes).filter(([k]) => !groups.some(g => g.codes.includes(k))))
        }
      })
    },

    // 把股票从源分组移动到目标分组
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
