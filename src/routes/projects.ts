import { Router, Request, Response } from 'express'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db'

const router = Router()

router.get('/projects', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM projects ORDER BY created_at DESC')
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des projets' })
  }
})

router.post('/projects', async (req: Request, res: Response) => {
  try {
    const { team_id, name, description, color } = req.body
    if (!name) {
      res.status(400).json({ error: 'Le nom du projet est requis' })
      return
    }
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO projects (team_id, name, description, color) VALUES (?, ?, ?, ?)',
      [team_id ?? null, name.trim(), description ?? '', color || '#6366f1']
    )
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM projects WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la création du projet' })
  }
})

router.put('/projects/:id', async (req: Request, res: Response) => {
  try {
    const { name, description, color, archived } = req.body
    const fields: string[] = []
    const values: unknown[] = []
    if (name !== undefined) { fields.push('name = ?'); values.push(name) }
    if (description !== undefined) { fields.push('description = ?'); values.push(description) }
    if (color !== undefined) { fields.push('color = ?'); values.push(color) }
    if (archived !== undefined) { fields.push('archived = ?'); values.push(!!archived) }
    if (fields.length === 0) {
      res.status(400).json({ error: 'Aucun champ à mettre à jour' })
      return
    }
    await pool.query(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, [...values, req.params.id])
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM projects WHERE id = ?', [req.params.id])
    if (!rows[0]) {
      res.status(404).json({ error: 'Projet introuvable' })
      return
    }
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour du projet' })
  }
})

export default router
