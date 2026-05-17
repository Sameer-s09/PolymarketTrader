import { Router } from 'express'
import { db } from '../db/index'

const router = Router()

// GET /api/chat — today's messages in chronological order
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, created_at, role, content, is_proactive, ts
    FROM chat_history
    WHERE DATE(created_at) = DATE('now')
    ORDER BY ts ASC
    LIMIT 200
  `).all() as Array<{ id: number; created_at: string; role: string; content: string; is_proactive: number; ts: number }>

  const messages = rows.map((r) => ({
    id:          r.id,
    role:        r.role,
    content:     r.content,
    isProactive: r.is_proactive === 1,
    timestamp:   r.ts,
  }))

  res.json({ messages })
})

// POST /api/chat/message — persist a single completed message
router.post('/message', (req, res) => {
  const { role, content, isProactive = false, timestamp } = req.body as {
    role: 'user' | 'assistant'
    content: string
    isProactive?: boolean
    timestamp?: number
  }

  if (!content?.trim() || !['user', 'assistant'].includes(role)) {
    res.status(400).json({ error: 'role and content required' })
    return
  }

  const ts = timestamp ?? Date.now()
  const info = db.prepare(`
    INSERT INTO chat_history (role, content, is_proactive, ts)
    VALUES (@role, @content, @is_proactive, @ts)
  `).run({ role, content: content.trim(), is_proactive: isProactive ? 1 : 0, ts })

  const row = db.prepare('SELECT * FROM chat_history WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>
  res.status(201).json({ ...row, isProactive: row.is_proactive === 1 })
})

// DELETE /api/chat — clear today's history
router.delete('/', (_req, res) => {
  db.prepare("DELETE FROM chat_history WHERE DATE(created_at) = DATE('now')").run()
  res.json({ ok: true })
})

export default router
