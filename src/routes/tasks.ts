import { Router, Request, Response } from 'express'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db'

const router = Router()

async function attachRelations(tasks: RowDataPacket[]) {
  if (tasks.length === 0) return []
  const ids = tasks.map((t) => t.id)
  const [reminders] = await pool.query<RowDataPacket[]>('SELECT * FROM task_reminders WHERE task_id IN (?)', [ids])
  const [attachments] = await pool.query<RowDataPacket[]>('SELECT * FROM task_attachments WHERE task_id IN (?)', [ids])
  const [comments] = await pool.query<RowDataPacket[]>('SELECT * FROM task_comments WHERE task_id IN (?) ORDER BY created_at', [ids])
  const [mentions] = comments.length
    ? await pool.query<RowDataPacket[]>('SELECT * FROM task_comment_mentions WHERE comment_id IN (?)', [comments.map((c) => c.id)])
    : [[] as RowDataPacket[]]

  return tasks.map((t) => ({
    ...t,
    reminders: reminders.filter((r) => r.task_id === t.id),
    attachments: attachments.filter((a) => a.task_id === t.id),
    comments: comments
      .filter((c) => c.task_id === t.id)
      .map((c) => ({
        ...c,
        mentioned_user_ids: mentions.filter((m) => m.comment_id === c.id).map((m) => m.mentioned_user_id),
      })),
  }))
}

router.get('/tasks', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM tasks ORDER BY deadline IS NULL, deadline')
    res.json(await attachRelations(rows))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des tâches' })
  }
})

router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const { project_id, team_id, title, description, assigned_to, priority, deadline } = req.body
    if (!project_id || !team_id || !title) {
      res.status(400).json({ error: 'project_id, team_id et title sont requis' })
      return
    }
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO tasks (project_id, team_id, title, description, assigned_to, created_by, priority, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [project_id, team_id, title.trim(), description ?? '', assigned_to ?? null, req.sdpUser!.id, priority || 'moyenne', deadline ?? null]
    )
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM tasks WHERE id = ?', [result.insertId])
    const [withRelations] = await attachRelations(rows)
    res.status(201).json(withRelations)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la création de la tâche' })
  }
})

const PATCHABLE_FIELDS = ['title', 'description', 'assigned_to', 'priority', 'status', 'deadline'] as const

router.put('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const fields: string[] = []
    const values: unknown[] = []
    for (const field of PATCHABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        fields.push(`${field} = ?`)
        values.push(req.body[field])
      }
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'Aucun champ à mettre à jour' })
      return
    }
    await pool.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, [...values, req.params.id])
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM tasks WHERE id = ?', [req.params.id])
    if (!rows[0]) {
      res.status(404).json({ error: 'Tâche introuvable' })
      return
    }
    const [withRelations] = await attachRelations(rows)
    res.json(withRelations)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la tâche' })
  }
})

router.delete('/tasks/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la suppression de la tâche' })
  }
})

router.post('/tasks/:id/reminders', async (req: Request, res: Response) => {
  try {
    const { remind_at } = req.body
    if (!remind_at) {
      res.status(400).json({ error: 'remind_at requis' })
      return
    }
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO task_reminders (task_id, remind_at) VALUES (?, ?)',
      [req.params.id, remind_at]
    )
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM task_reminders WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la création du rappel' })
  }
})

router.post('/tasks/:id/comments', async (req: Request, res: Response) => {
  try {
    const { body, mentioned_user_ids } = req.body
    if (!body || typeof body !== 'string') {
      res.status(400).json({ error: 'body requis' })
      return
    }
    const authorId = req.sdpUser!.id
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)',
      [req.params.id, authorId, body]
    )
    const commentId = result.insertId

    const mentionIds: number[] = Array.isArray(mentioned_user_ids) ? mentioned_user_ids : []
    for (const userId of mentionIds) {
      await pool.query('INSERT IGNORE INTO task_comment_mentions (comment_id, mentioned_user_id) VALUES (?, ?)', [commentId, userId])
      if (userId !== authorId) {
        await pool.query(
          'INSERT INTO task_notifications (task_id, comment_id, recipient_user_id, from_user_id) VALUES (?, ?, ?, ?)',
          [req.params.id, commentId, userId, authorId]
        )
      }
    }

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM task_comments WHERE id = ?', [commentId])
    res.status(201).json({ ...rows[0], mentioned_user_ids: mentionIds })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire" })
  }
})

router.post('/tasks/:id/notify-team', async (req: Request, res: Response) => {
  try {
    const { team_member_ids, comment_id } = req.body
    if (!Array.isArray(team_member_ids)) {
      res.status(400).json({ error: 'team_member_ids requis' })
      return
    }
    const authorId = req.sdpUser!.id
    for (const userId of team_member_ids) {
      if (userId === authorId) continue
      await pool.query(
        'INSERT INTO task_notifications (task_id, comment_id, recipient_user_id, from_user_id) VALUES (?, ?, ?, ?)',
        [req.params.id, comment_id ?? null, userId, authorId]
      )
    }
    res.status(201).json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'envoi de la notification" })
  }
})

export default router
