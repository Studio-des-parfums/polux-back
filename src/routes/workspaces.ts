import { Router, Request, Response } from 'express'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db.js'
import { deleteTaskAttachment } from '../services/s3.js'
import { DEFAULT_WORKSPACE_SLUG } from '../middleware/requireWorkspace.js'

// Gestion des espaces Polux — réservée aux admins. Monté hors de requireWorkspace : ces
// routes ne s'exécutent pas « dans » un espace.
const router = Router()

type Conn = Awaited<ReturnType<typeof pool.getConnection>>

// Copie des équipes d'un espace source vers un espace cible (nom, couleur, responsable,
// membres). Copies non officielles : les équipes officielles restent liées au Polux principal.
// Une équipe dont le slug existe déjà dans la cible est ignorée. Retourne le nombre copié.
async function copyTeams(conn: Conn, sourceSlug: string, targetId: number, teamIds: number[] | null, authorId: number): Promise<number> {
  const [[source]] = await conn.query<RowDataPacket[]>('SELECT id FROM workspaces WHERE slug = ?', [sourceSlug])
  if (!source) throw Object.assign(new Error('Espace source introuvable'), { status: 400 })
  const [teams] = await conn.query<RowDataPacket[]>(
    `SELECT id, slug, name, color, manager_user_id FROM teams WHERE workspace_id = ?${teamIds ? ' AND id IN (?)' : ''}`,
    teamIds ? [source.id, teamIds] : [source.id]
  )
  let copied = 0
  for (const team of teams) {
    const [inserted] = await conn.query<ResultSetHeader>(
      `INSERT IGNORE INTO teams (workspace_id, slug, name, color, manager_user_id, is_official, created_by)
       VALUES (?, ?, ?, ?, ?, FALSE, ?)`,
      [targetId, team.slug, team.name, team.color, team.manager_user_id, authorId]
    )
    if (!inserted.insertId || inserted.affectedRows === 0) continue
    await conn.query('INSERT INTO team_members (team_id, user_id) SELECT ?, user_id FROM team_members WHERE team_id = ?', [inserted.insertId, team.id])
    copied++
  }
  return copied
}

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
      await copyTeams(conn, copy_teams_from, workspaceId, teamIds, req.sdpUser!.id)
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

// Reprendre après coup des équipes d'un autre espace dans `:slug`.
router.post('/workspaces/:slug/import-teams', async (req: Request, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Réservé aux administrateurs' })
    return
  }
  const { from, team_ids } = req.body ?? {}
  const teamIds = Array.isArray(team_ids) ? team_ids.map(Number).filter(Number.isInteger) : []
  if (typeof from !== 'string' || teamIds.length === 0) {
    res.status(400).json({ error: 'Espace source et équipes requis' })
    return
  }
  const conn = await pool.getConnection()
  try {
    const [[target]] = await conn.query<RowDataPacket[]>('SELECT id FROM workspaces WHERE slug = ?', [req.params.slug])
    if (!target) {
      res.status(404).json({ error: 'Espace introuvable' })
      return
    }
    await conn.beginTransaction()
    const copied = await copyTeams(conn, from, target.id, teamIds, req.sdpUser!.id)
    await conn.commit()
    res.json({ copied, skipped: teamIds.length - copied })
  } catch (err: any) {
    await conn.rollback()
    if (err.status === 400) {
      res.status(400).json({ error: err.message })
      return
    }
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'import des équipes" })
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

// Supprime un espace et, par cascade (migration 023), ses équipes, tâches, leads et accès.
// Le Polux principal ne peut pas être supprimé. Les fichiers S3 des pièces jointes sont
// effacés ensuite (best effort : une erreur S3 ne bloque pas la suppression).
router.delete('/workspaces/:slug', async (req: Request, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Réservé aux administrateurs' })
    return
  }
  if (req.params.slug === DEFAULT_WORKSPACE_SLUG) {
    res.status(400).json({ error: "Le Polux principal ne peut pas être supprimé" })
    return
  }
  try {
    const [[workspace]] = await pool.query<RowDataPacket[]>('SELECT id FROM workspaces WHERE slug = ?', [req.params.slug])
    if (!workspace) {
      res.json({ success: true })
      return
    }
    const [attachments] = await pool.query<RowDataPacket[]>(
      'SELECT a.s3_key FROM task_attachments a JOIN tasks t ON t.id = a.task_id WHERE t.workspace_id = ?', [workspace.id]
    )
    await pool.query('DELETE FROM workspaces WHERE id = ?', [workspace.id])
    for (const a of attachments) await deleteTaskAttachment(a.s3_key).catch((err) => console.error(err))
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la suppression de l'espace" })
  }
})

export default router
