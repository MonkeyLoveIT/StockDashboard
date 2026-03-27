import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Position Store - 持仓状态管理（支持 localStorage 持久化）
const usePositionStore = create(persist(
  (set, get) => ({
    positions: [],
    quotes: {}, // { code: quoteData }
    watchList: [], // 自选股代码列表
    loading: false,
    error: null,

    // 获取所有持仓
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

    // 添加持仓
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

    // 更新持仓
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

    // 删除持仓
    deletePosition: async (positionApi, id) => {
      try {
        await positionApi.delete(id)
        set(state => ({
          positions: state.positions.filter(p => p.id !== id)
        }))
      } catch (error) {
        set({ error: error.message })
        throw error
      }
    },

    // 更新单只行情
    updateQuote: (code, quote) => {
      set(state => ({
        quotes: { ...state.quotes, [code]: quote }
      }))
    },

    // 批量更新行情
    updateQuotes: (quotes) => {
      const quotesMap = {}
      quotes.forEach(q => {
        if (q && q.code) {
          quotesMap[q.code] = q
        }
      })
      set(state => ({
        quotes: { ...state.quotes, ...quotesMap }
      }))
    },

    // 自选股管理
    addToWatchList: (code) => {
      set(state => {
        const list = state.watchList || []
        if (list.includes(code)) return state
        return { watchList: [...list, code] }
      })
    },
    removeFromWatchList: (code) => {
      set(state => {
        const list = state.watchList || []
        return {
          watchList: list.filter(c => c !== code),
          quotes: Object.fromEntries(
            Object.entries(state.quotes).filter(([k]) => k !== code)
          )
        }
      })
    },
    // 确保 watchList 有初始值
    getWatchList: () => {
      const state = get()
      return state.watchList || []
    }
  }),
  {
    name: 'stock-dashboard-storage',
    partialize: (state) => ({
      positions: Array.isArray(state.positions) ? state.positions : [],
      quotes: state.quotes || {},
      watchList: Array.isArray(state.watchList) ? state.watchList : []
    })
  }
))

export default usePositionStore
