import { Router, Request, Response } from 'express'
import { RowDataPacket } from 'mysql2'
import { sdpPool } from '../db'

const router = Router()

// Liste des utilisateurs actifs du dashboard principal — lecture seule, utilisée pour
// peupler les sélecteurs d'assignation/mention côté front Polux.
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const [rows] = await sdpPool.query<RowDataPacket[]>(
      'SELECT id, email, first_name, last_name FROM users WHERE is_active = TRUE ORDER BY first_name, last_name'
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' })
  }
})

export default router
