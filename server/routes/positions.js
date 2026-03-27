import express from 'express'
import { positionOps } from '../db.js'

const router = express.Router()

// GET all positions
router.get('/', async (req, res) => {
  try {
    const positions = await positionOps.getAll()
    res.json(positions)
  } catch (error) {
    console.error('Error getting positions:', error)
    res.status(500).json({ error: 'Failed to get positions' })
  }
})

// GET single position
router.get('/:id', async (req, res) => {
  try {
    const position = await positionOps.getById(req.params.id)
    if (!position) {
      return res.status(404).json({ error: 'Position not found' })
    }
    res.json(position)
  } catch (error) {
    console.error('Error getting position:', error)
    res.status(500).json({ error: 'Failed to get position' })
  }
})

// POST create position
router.post('/', async (req, res) => {
  try {
    const { code, name, cost, shares, position_pct } = req.body
    if (!code || !cost || !shares) {
      return res.status(400).json({ error: 'code, cost, and shares are required' })
    }
    const position = await positionOps.create({ code, name, cost, shares, position_pct })
    res.status(201).json(position)
  } catch (error) {
    console.error('Error creating position:', error)
    res.status(500).json({ error: 'Failed to create position' })
  }
})

// PUT update position
router.put('/:id', async (req, res) => {
  try {
    const { code, name, cost, shares, position_pct } = req.body
    const existing = await positionOps.getById(req.params.id)
    if (!existing) {
      return res.status(404).json({ error: 'Position not found' })
    }
    const position = await positionOps.update(req.params.id, {
      code: code ?? existing.code,
      name: name ?? existing.name,
      cost: cost ?? existing.cost,
      shares: shares ?? existing.shares,
      position_pct: position_pct ?? existing.position_pct
    })
    res.json(position)
  } catch (error) {
    console.error('Error updating position:', error)
    res.status(500).json({ error: 'Failed to update position' })
  }
})

// DELETE position
router.delete('/:id', async (req, res) => {
  try {
    const existing = await positionOps.getById(req.params.id)
    if (!existing) {
      return res.status(404).json({ error: 'Position not found' })
    }
    await positionOps.delete(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting position:', error)
    res.status(500).json({ error: 'Failed to delete position' })
  }
})

export default router
