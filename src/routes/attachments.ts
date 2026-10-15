import { Router, Request, Response } from 'express'
import multer from 'multer'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db'
import { uploadTaskAttachment, deleteTaskAttachment } from '../services/s3'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

router.post('/tasks/:id/attachments', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file
    if (!file) {
      res.status(400).json({ error: 'Fichier requis' })
      return
    }
    const taskId = Number(req.params.id)
    const { key, url } = await uploadTaskAttachment(taskId, file.buffer, file.originalname, file.mimetype)

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO task_attachments (task_id, filename, s3_key, url, content_type, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [taskId, file.originalname, key, url, file.mimetype, file.size, req.sdpUser!.id]
    )
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM task_attachments WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'envoi du fichier" })
  }
})

router.delete('/attachments/:id', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM task_attachments WHERE id = ?', [req.params.id])
    const attachment = rows[0]
    if (!attachment) {
      res.status(404).json({ error: 'Pièce jointe introuvable' })
      return
    }
    await deleteTaskAttachment(attachment.s3_key)
    await pool.query('DELETE FROM task_attachments WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la suppression de la pièce jointe' })
  }
})

export default router
