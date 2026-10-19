import { Router, Request, Response } from 'express'
import multer from 'multer'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db.js'
import { uploadTaskAttachment, deleteTaskAttachment, getTaskAttachmentUrl } from '../services/s3.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

router.post('/tasks/:id/attachments', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'Fichier requis' })
      return
    }
    const taskId = Number(req.params.id)
    const created: RowDataPacket[] = []
    for (const file of files) {
      const { key } = await uploadTaskAttachment(taskId, file.buffer, file.originalname, file.mimetype)
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO task_attachments (task_id, filename, s3_key, content_type, size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [taskId, file.originalname, key, file.mimetype, file.size, req.sdpUser!.id]
      )
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM task_attachments WHERE id = ?', [result.insertId])
      created.push(rows[0])
    }
    const withUrls = await Promise.all(created.map(async (a) => ({ ...a, url: await getTaskAttachmentUrl(a.s3_key) })))
    res.status(201).json(withUrls)
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
