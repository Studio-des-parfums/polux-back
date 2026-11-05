import { Router, Request, Response } from 'express'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db.js'
import { listAllUsers } from '../services/dashboardUsers.js'
import { notify } from '../services/notify.js'

const router = Router()

function isAdmin(req: Request): boolean {
  return req.sdpUser?.role_name === 'admin'
}

// Utilisateurs du dashboard principal, anciens membres compris (is_active = false) : ils
// restent nécessaires pour afficher qui a créé, commenté ou fait une tâche. Les sélecteurs
// d'assignation/mention côté front ne proposent que les actifs.
router.get('/users', async (_req: Request, res: Response) => {
  try {
    res.json(await listAllUsers())
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' })
  }
})

// Identité Polux de la personne connectée, déduite de son email sdp_dashboard (déjà
// vérifié par requireUser) — utilisé côté front pour comparer son id à member_ids /
// leads_access sans dupliquer la logique d'authentification.
router.get('/users/me', async (req: Request, res: Response) => {
  const { id, email, first_name, last_name } = req.sdpUser!
  res.json({ id, email, first_name, last_name })
})

// Tâches non terminées d'un utilisateur : assignées ou personnelles.
const OPEN_TASKS_SQL = `
  SELECT DISTINCT t.id, t.title FROM tasks t
  LEFT JOIN task_assignees a ON a.task_id = t.id AND a.user_id = ?
  WHERE t.status <> 'termine' AND (a.user_id IS NOT NULL OR t.owner_id = ?)`

// Travail encore en cours d'un utilisateur — affiché avant son départ pour choisir à qui
// le transférer. L'historique (créateur, commentaires, tâches terminées) n'est jamais modifié.
router.get('/users/:id/open-work', async (req: Request, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Réservé aux administrateurs' })
    return
  }
  const userId = Number(req.params.id)
  try {
    const [tasks] = await pool.query<RowDataPacket[]>(OPEN_TASKS_SQL, [userId, userId])
    const [teams] = await pool.query<RowDataPacket[]>('SELECT id, name FROM teams WHERE manager_user_id = ?', [userId])
    const [leads] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM leads WHERE assigned_to_id = ? AND status NOT IN ('realise', 'perdu')`,
      [userId]
    )
    res.json({ tasks, managed_teams: teams, open_leads_count: Number(leads[0].n) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération du travail en cours' })
  }
})

// Départ d'un utilisateur : ses tâches non terminées, ses leads ouverts et ses équipes
// gérées passent à `to_user_id`. Il est retiré des équipes et des accès leads. Les tâches
// terminées, commentaires et created_by restent à son nom pour garder la trace.
router.post('/users/:id/transfer', async (req: Request, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Réservé aux administrateurs' })
    return
  }
  const fromId = Number(req.params.id)
  const toId = Number(req.body?.to_user_id)
  if (!Number.isInteger(toId) || toId <= 0 || toId === fromId) {
    res.status(400).json({ error: 'Destinataire du transfert invalide' })
    return
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [tasks] = await conn.query<RowDataPacket[]>(OPEN_TASKS_SQL, [fromId, fromId])
    const taskIds = tasks.map((t) => t.id as number)
    if (taskIds.length > 0) {
      await conn.query(
        `INSERT IGNORE INTO task_assignees (task_id, user_id)
         SELECT task_id, ? FROM task_assignees WHERE user_id = ? AND task_id IN (?)`,
        [toId, fromId, taskIds]
      )
      await conn.query('DELETE FROM task_assignees WHERE user_id = ? AND task_id IN (?)', [fromId, taskIds])
      await conn.query('UPDATE tasks SET owner_id = ? WHERE owner_id = ? AND id IN (?)', [toId, fromId, taskIds])
    }
    await conn.query('UPDATE teams SET manager_user_id = ? WHERE manager_user_id = ?', [toId, fromId])
    const [leads] = await conn.query<ResultSetHeader>(
      `UPDATE leads SET assigned_to_id = ? WHERE assigned_to_id = ? AND status NOT IN ('realise', 'perdu')`,
      [toId, fromId]
    )
    await conn.query('DELETE FROM team_members WHERE user_id = ?', [fromId])
    await conn.query('DELETE FROM leads_access WHERE user_id = ?', [fromId])
    await conn.commit()

    for (const t of tasks) {
      await notify({
        taskId: t.id, type: 'assigned', recipientIds: [toId], fromUserId: req.sdpUser!.id,
        message: `La tâche « ${t.title} » vous a été transférée`,
        email: { title: 'Tâche transférée', taskTitle: t.title },
      }).catch((err) => console.error(err))
    }
    res.json({ transferred_tasks: taskIds.length, transferred_leads: leads.affectedRows })
  } catch (err) {
    await conn.rollback()
    console.error(err)
    res.status(500).json({ error: 'Erreur lors du transfert du travail en cours' })
  } finally {
    conn.release()
  }
})

export default router
