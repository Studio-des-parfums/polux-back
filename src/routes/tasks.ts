import { Router, Request, Response } from 'express'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db'
import { getTaskAttachmentUrl } from '../services/s3'
import { sendAssignedEmail, sendMentionEmail } from '../services/email'
import { getUserContacts } from '../utils/users'

const router = Router()

// mysql2 n'accepte pas le format ISO 8601 ('2026-10-16T00:00:00.000Z') pour une colonne
// DATETIME — on le convertit en 'YYYY-MM-DD HH:MM:SS' attendu par MySQL.
function toMysqlDatetime(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ')
}

async function attachRelations(tasks: RowDataPacket[]) {
  if (tasks.length === 0) return []
  const ids = tasks.map((t) => t.id)
  const [assignees] = await pool.query<RowDataPacket[]>('SELECT * FROM task_assignees WHERE task_id IN (?)', [ids])
  const [reminders] = await pool.query<RowDataPacket[]>('SELECT * FROM task_reminders WHERE task_id IN (?)', [ids])
  const [attachments] = await pool.query<RowDataPacket[]>('SELECT * FROM task_attachments WHERE task_id IN (?)', [ids])
  const [comments] = await pool.query<RowDataPacket[]>('SELECT * FROM task_comments WHERE task_id IN (?) ORDER BY created_at', [ids])
  const [mentions] = comments.length
    ? await pool.query<RowDataPacket[]>('SELECT * FROM task_comment_mentions WHERE comment_id IN (?)', [comments.map((c) => c.id)])
    : [[] as RowDataPacket[]]

  const attachmentsWithUrls: Array<RowDataPacket & { url: string }> = await Promise.all(
    attachments.map(async (a) => ({ ...a, url: await getTaskAttachmentUrl(a.s3_key) }))
  )

  return tasks.map((t) => ({
    ...t,
    assigned_to_ids: assignees.filter((a) => a.task_id === t.id).map((a) => a.user_id),
    reminders: reminders.filter((r) => r.task_id === t.id),
    attachments: attachmentsWithUrls.filter((a) => a.task_id === t.id),
    comments: comments
      .filter((c) => c.task_id === t.id)
      .map((c) => ({
        ...c,
        mentioned_user_ids: mentions.filter((m) => m.comment_id === c.id).map((m) => m.mentioned_user_id),
      })),
  }))
}

// Retourne les user_id nouvellement assignés (absents de l'ancienne liste), pour
// déclencher l'email d'assignation uniquement sur un vrai ajout, pas à chaque patch.
async function setAssignees(taskId: number, userIds: number[]): Promise<number[]> {
  const [existing] = await pool.query<RowDataPacket[]>('SELECT user_id FROM task_assignees WHERE task_id = ?', [taskId])
  const existingIds = new Set(existing.map((r) => r.user_id))
  const newIds = userIds.filter((id) => !existingIds.has(id))

  await pool.query('DELETE FROM task_assignees WHERE task_id = ?', [taskId])
  for (const userId of userIds) {
    await pool.query('INSERT IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)', [taskId, userId])
  }
  return newIds
}

async function notifyNewAssignees(taskId: number, taskTitle: string, newAssigneeIds: number[], authorId: number) {
  const recipients = newAssigneeIds.filter((id) => id !== authorId)
  if (recipients.length === 0) return
  const [contacts, [author]] = await Promise.all([getUserContacts(recipients), getUserContacts([authorId])])
  for (const contact of contacts) {
    await pool.query(
      'INSERT INTO task_notifications (task_id, recipient_user_id, from_user_id) VALUES (?, ?, ?)',
      [taskId, contact.id, authorId]
    )
    await sendAssignedEmail(contact.email, author ? `${author.first_name} ${author.last_name}` : 'Un collègue', taskTitle)
  }
}

// Une tâche sans équipe (team_id NULL) est une tâche personnelle : on ne la renvoie qu'à
// qui l'a créée (owner_id), pour ne jamais exposer les tâches perso d'un autre utilisateur.
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM tasks WHERE owner_id IS NULL OR owner_id = ? ORDER BY deadline IS NULL, deadline',
      [req.sdpUser!.id]
    )
    res.json(await attachRelations(rows))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des tâches' })
  }
})

router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const { project_name, team_id, title, description, assigned_to_ids, priority, color, start_date, deadline } = req.body
    if (!title) {
      res.status(400).json({ error: 'title est requis' })
      return
    }
    const ownerId = team_id ? null : req.sdpUser!.id
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO tasks (project_name, team_id, title, description, created_by, owner_id, priority, color, start_date, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [project_name?.trim() || null, team_id || null, title.trim(), description ?? '', req.sdpUser!.id, ownerId, priority || 'moyenne', color || null, toMysqlDatetime(start_date), toMysqlDatetime(deadline)]
    )
    // Une tâche personnelle n'a pas d'équipe à notifier : on s'assigne automatiquement
    // soi-même, pour que l'affichage (avatars, filtre "mes tâches") reste cohérent.
    const finalAssigneeIds = ownerId && (!Array.isArray(assigned_to_ids) || assigned_to_ids.length === 0)
      ? [ownerId]
      : assigned_to_ids
    if (Array.isArray(finalAssigneeIds) && finalAssigneeIds.length > 0) {
      const newIds = await setAssignees(result.insertId, finalAssigneeIds)
      await notifyNewAssignees(result.insertId, title.trim(), newIds, req.sdpUser!.id)
    }
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM tasks WHERE id = ?', [result.insertId])
    const [withRelations] = await attachRelations(rows)
    res.status(201).json(withRelations)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la création de la tâche' })
  }
})

const PATCHABLE_FIELDS = ['title', 'description', 'project_name', 'priority', 'color', 'status', 'start_date', 'deadline'] as const
const DATETIME_FIELDS = new Set(['start_date', 'deadline'])

router.put('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const fields: string[] = []
    const values: unknown[] = []
    for (const field of PATCHABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        fields.push(`${field} = ?`)
        values.push(DATETIME_FIELDS.has(field) ? toMysqlDatetime(req.body[field]) : req.body[field])
      }
    }
    if (fields.length > 0) {
      await pool.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, [...values, req.params.id])
    }
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM tasks WHERE id = ?', [req.params.id])
    if (!rows[0]) {
      res.status(404).json({ error: 'Tâche introuvable' })
      return
    }
    if (Array.isArray(req.body.assigned_to_ids)) {
      const newIds = await setAssignees(Number(req.params.id), req.body.assigned_to_ids)
      await notifyNewAssignees(Number(req.params.id), rows[0].title, newIds, req.sdpUser!.id)
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
      [req.params.id, toMysqlDatetime(remind_at)]
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
    const recipientIds = mentionIds.filter((id) => id !== authorId)
    if (recipientIds.length > 0) {
      const [task] = await pool.query<RowDataPacket[]>('SELECT title FROM tasks WHERE id = ?', [req.params.id])
      const [contacts, authorContacts] = await Promise.all([getUserContacts(recipientIds), getUserContacts([authorId])])
      const authorName = authorContacts[0] ? `${authorContacts[0].first_name} ${authorContacts[0].last_name}` : 'Un collègue'
      for (const contact of contacts) {
        await pool.query(
          'INSERT INTO task_notifications (task_id, comment_id, recipient_user_id, from_user_id) VALUES (?, ?, ?, ?)',
          [req.params.id, commentId, contact.id, authorId]
        )
        await sendMentionEmail(contact.email, authorName, task[0]?.title ?? '', body)
      }
    }
    for (const userId of mentionIds) {
      await pool.query('INSERT IGNORE INTO task_comment_mentions (comment_id, mentioned_user_id) VALUES (?, ?)', [commentId, userId])
    }

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM task_comments WHERE id = ?', [commentId])
    res.status(201).json({ ...rows[0], mentioned_user_ids: mentionIds })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire" })
  }
})

export default router
