import { Router, Request, Response } from 'express'
import { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'

const router = Router()

router.get('/notifications', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT n.*, t.title as task_title
       FROM task_notifications n
       JOIN tasks t ON t.id = n.task_id
       WHERE n.recipient_user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.sdpUser!.id]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des notifications' })
  }
})

router.get('/notifications/unread-count', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM task_notifications WHERE recipient_user_id = ? AND is_read = FALSE',
      [req.sdpUser!.id]
    )
    res.json({ count: rows[0].count })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors du comptage des notifications' })
  }
})

router.put('/notifications/:id/read', async (req: Request, res: Response) => {
  try {
    await pool.query(
      'UPDATE task_notifications SET is_read = TRUE WHERE id = ? AND recipient_user_id = ?',
      [req.params.id, req.sdpUser!.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la notification' })
  }
})

router.put('/notifications/read-all', async (req: Request, res: Response) => {
  try {
    await pool.query(
      'UPDATE task_notifications SET is_read = TRUE WHERE recipient_user_id = ? AND is_read = FALSE',
      [req.sdpUser!.id]
    )
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour des notifications' })
  }
})

export default router
