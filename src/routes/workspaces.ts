import { Router, Request, Response } from 'express'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db.js'

// Gestion des espaces Polux — réservée aux admins. Monté hors de requireWorkspace : ces
// routes ne s'exécutent pas « dans » un espace.
const router = Router()

function isAdmin(req: Request): boolean {
  return req.sdpUser?.role_name === 'admin'
}

router.get('/workspaces', async (req: Request, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Réservé aux administrateurs' })
    return
  }
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, slug, name, color, created_at FROM workspaces ORDER BY id')
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des espaces' })
  }
})

// Crée un espace. Le slug est celui du projet sdp_dashboard créé juste avant par l'admin
// (c'est lui qui porte les accès). `copy_teams_from` : slug d'un espace dont on reprend les
// équipes (nom, couleur, responsable, membres) — copiées, donc indépendantes ensuite.
// `copy_team_ids` (optionnel) : seulement ces équipes de l'espace source ; absent = toutes.
router.post('/workspaces', async (req: Request, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Réservé aux administrateurs' })
    return
  }
  const { slug, name, color, copy_teams_from, copy_team_ids } = req.body ?? {}
  const teamIds: number[] | null = Array.isArray(copy_team_ids) ? copy_team_ids.map(Number).filter(Number.isInteger) : null
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug) || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Nom et slug valides requis' })
    return
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [result] = await conn.query<ResultSetHeader>(
      'INSERT INTO workspaces (slug, name, color, created_by) VALUES (?, ?, ?, ?)',
      [slug, name.trim(), color || '#6366f1', req.sdpUser!.id]
    )
    const workspaceId = result.insertId

    if (copy_teams_from && (teamIds === null || teamIds.length > 0)) {
      const [[source]] = await conn.query<RowDataPacket[]>('SELECT id FROM workspaces WHERE slug = ?', [copy_teams_from])
      if (!source) throw Object.assign(new Error('Espace source introuvable'), { status: 400 })
      // Copies non officielles : les équipes officielles restent liées au Polux principal
      // (synchronisées avec les équipes des utilisateurs du dashboard).
      const [teams] = await conn.query<RowDataPacket[]>(
        `SELECT id, slug, name, color, manager_user_id FROM teams WHERE workspace_id = ?${teamIds ? ' AND id IN (?)' : ''}`,
        teamIds ? [source.id, teamIds] : [source.id]
      )
      for (const team of teams) {
        const [inserted] = await conn.query<ResultSetHeader>(
          'INSERT INTO teams (workspace_id, slug, name, color, manager_user_id, is_official, created_by) VALUES (?, ?, ?, ?, ?, FALSE, ?)',
          [workspaceId, team.slug, team.name, team.color, team.manager_user_id, req.sdpUser!.id]
        )
        await conn.query(
          'INSERT INTO team_members (team_id, user_id) SELECT ?, user_id FROM team_members WHERE team_id = ?',
          [inserted.insertId, team.id]
        )
      }
    }
    await conn.commit()
    const [[workspace]] = await pool.query<RowDataPacket[]>('SELECT id, slug, name, color, created_at FROM workspaces WHERE id = ?', [workspaceId])
    res.status(201).json(workspace)
  } catch (err: any) {
    await conn.rollback()
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Un espace avec ce slug existe déjà' })
      return
    }
    if (err.status === 400) {
      res.status(400).json({ error: err.message })
      return
    }
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la création de l'espace" })
  } finally {
    conn.release()
  }
})

// Renommer / recolorer un espace. Le slug ne change jamais (lié au projet du dashboard).
router.patch('/workspaces/:slug', async (req: Request, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Réservé aux administrateurs' })
    return
  }
  try {
    const { name, color } = req.body ?? {}
    await pool.query(
      'UPDATE workspaces SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE slug = ?',
      [typeof name === 'string' && name.trim() ? name.trim() : null, color || null, req.params.slug]
    )
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la mise à jour de l'espace" })
  }
})

export default router
