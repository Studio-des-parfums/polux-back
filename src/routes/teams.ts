import { Router, Request, Response } from 'express'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db.js'

const router = Router()

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// created_by n'est jamais exposé dans l'API : la restriction de suppression se fait
// côté serveur (voir DELETE /teams/:id), pas affiché au client.
router.get('/teams', async (_req: Request, res: Response) => {
  try {
    const [teams] = await pool.query<RowDataPacket[]>('SELECT id, slug, name, color, is_official, created_at FROM teams ORDER BY name')
    const [members] = await pool.query<RowDataPacket[]>('SELECT team_id, user_id FROM team_members')
    const result = teams.map((t) => ({
      ...t,
      member_ids: members.filter((m) => m.team_id === t.id).map((m) => m.user_id),
    }))
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des équipes' })
  }
})

router.post('/teams', async (req: Request, res: Response) => {
  try {
    const { name, color } = req.body
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Le nom de l\'équipe est requis' })
      return
    }
    const slug = slugify(name)
    if (!slug) {
      res.status(400).json({ error: 'Nom invalide' })
      return
    }

    const creatorId = req.sdpUser!.id
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO teams (slug, name, color, created_by) VALUES (?, ?, ?, ?)',
      [slug, name.trim(), color || '#6366f1', creatorId]
    )
    await pool.query('INSERT IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)', [result.insertId, creatorId])

    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, slug, name, color, is_official, created_at FROM teams WHERE id = ?', [result.insertId])
    res.status(201).json({ ...rows[0], member_ids: [creatorId] })
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Une équipe avec un nom proche existe déjà' })
      return
    }
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la création de l'équipe" })
  }
})

router.post('/teams/:id/members', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.body
    if (!user_id) {
      res.status(400).json({ error: 'user_id requis' })
      return
    }
    await pool.query('INSERT IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)', [req.params.id, user_id])
    res.status(201).json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'ajout du membre" })
  }
})

router.delete('/teams/:id/members/:userId', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [req.params.id, req.params.userId])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la suppression du membre' })
  }
})

// Supprime l'équipe et, par cascade (voir migrations/001_init.sql), ses tâches,
// commentaires, pièces jointes et notifications associées — réservé au créateur.
router.delete('/teams/:id', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT created_by, is_official FROM teams WHERE id = ?', [req.params.id])
    if (!rows[0]) {
      res.status(404).json({ error: 'Équipe introuvable' })
      return
    }
    if (rows[0].is_official) {
      res.status(403).json({ error: 'Cette équipe est officielle et ne peut pas être supprimée' })
      return
    }
    if (rows[0].created_by !== req.sdpUser!.id) {
      res.status(403).json({ error: 'Seule la personne ayant créé cette équipe peut la supprimer' })
      return
    }
    await pool.query('DELETE FROM teams WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la suppression de l'équipe" })
  }
})

export default router
