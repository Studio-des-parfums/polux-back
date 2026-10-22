import { Router, Request, Response } from 'express'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db.js'
import { getTaskAttachmentUrls } from '../services/s3.js'
import { sendAssignedEmail, sendMentionEmail, sendValidationRequestEmail } from '../services/email.js'
import { getUserContacts } from '../utils/users.js'

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
  const [checklist] = await pool.query<RowDataPacket[]>('SELECT * FROM task_checklist_items WHERE task_id IN (?) ORDER BY position, id', [ids])
  const linkedIds = checklist.map((c) => c.linked_task_id).filter((id) => id != null)
  const [linkedTasks] = linkedIds.length
    ? await pool.query<RowDataPacket[]>('SELECT id, team_id, status FROM tasks WHERE id IN (?)', [linkedIds])
    : [[] as RowDataPacket[]]
  const [linkedAssignees] = linkedIds.length
    ? await pool.query<RowDataPacket[]>('SELECT task_id, user_id FROM task_assignees WHERE task_id IN (?)', [linkedIds])
    : [[] as RowDataPacket[]]
  const [parentSteps] = await pool.query<RowDataPacket[]>(
    `SELECT c.linked_task_id, c.task_id, p.title FROM task_checklist_items c
     JOIN tasks p ON p.id = c.task_id WHERE c.linked_task_id IN (?)`,
    [ids]
  )
  const leadIds = [...new Set(tasks.map((t) => t.lead_id).filter((id) => id != null))]
  const [leads] = leadIds.length
    ? await pool.query<RowDataPacket[]>('SELECT id, first_name, last_name, company FROM leads WHERE id IN (?)', [leadIds])
    : [[] as RowDataPacket[]]
  const [mentions] = comments.length
    ? await pool.query<RowDataPacket[]>('SELECT * FROM task_comment_mentions WHERE comment_id IN (?)', [comments.map((c) => c.id)])
    : [[] as RowDataPacket[]]

  const attachmentsWithUrls: Array<RowDataPacket & { url: string }> = await Promise.all(
    attachments.map(async (a) => ({ ...a, ...(await getTaskAttachmentUrls({ s3_key: a.s3_key, filename: a.filename, content_type: a.content_type })) }))
  )

  return tasks.map((t) => ({
    ...t,
    assigned_to_ids: assignees.filter((a) => a.task_id === t.id).map((a) => a.user_id),
    lead: leads.find((l) => l.id === t.lead_id) ?? null,
    reminders: reminders.filter((r) => r.task_id === t.id),
    attachments: attachmentsWithUrls.filter((a) => a.task_id === t.id),
    checklist: checklist
      .filter((c) => c.task_id === t.id)
      .map((c) => {
        const linked = linkedTasks.find((l) => l.id === c.linked_task_id)
        return {
          ...c,
          linked_task: linked
            ? { ...linked, assigned_to_ids: linkedAssignees.filter((a) => a.task_id === linked.id).map((a) => a.user_id) }
            : null,
        }
      }),
    parent_step: (() => {
      const step = parentSteps.find((s) => s.linked_task_id === t.id)
      return step ? { task_id: step.task_id, title: step.title } : null
    })(),
    comments: comments
      .filter((c) => c.task_id === t.id)
      .map((c) => ({
        ...c,
        mentioned_user_ids: mentions.filter((m) => m.comment_id === c.id).map((m) => m.mentioned_user_id),
      })),
  }))
}

// Si tous les items de la checklist d'une tâche sont cochés, elle passe automatiquement
// en 'termine' ; si on décoche un item d'une tâche déjà terminée, elle repasse en 'en_cours'.
async function syncTaskStatusWithChecklist(taskId: number) {
  const [items] = await pool.query<RowDataPacket[]>('SELECT done FROM task_checklist_items WHERE task_id = ?', [taskId])
  if (items.length === 0) return
  const allDone = items.every((i) => i.done)
  const [[task]] = await pool.query<RowDataPacket[]>('SELECT status FROM tasks WHERE id = ?', [taskId])
  if (allDone && task.status !== 'termine') {
    const status = (await isDelegatedStep(taskId)) ? 'en_revision' : 'termine'
    if (task.status === status) return
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', [status, taskId])
    await syncParentStep(taskId)
  } else if (!allDone && task.status === 'termine') {
    await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['en_cours', taskId])
    await syncParentStep(taskId)
  }
}

// Une étape confiée (tâche liée à l'étape d'une checklist) doit être validée par la personne
// qui l'a confiée : la terminer la fait passer en 'en_revision' jusqu'à cette validation.
async function isDelegatedStep(taskId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT 1 FROM task_checklist_items WHERE linked_task_id = ? LIMIT 1', [taskId])
  return rows.length > 0
}

async function requestValidation(taskId: number, fromUserId: number) {
  const [[task]] = await pool.query<RowDataPacket[]>('SELECT title, created_by FROM tasks WHERE id = ?', [taskId])
  if (!task || task.created_by === fromUserId) return
  await pool.query(
    'INSERT INTO task_notifications (task_id, recipient_user_id, from_user_id) VALUES (?, ?, ?)',
    [taskId, task.created_by, fromUserId]
  )
  const [[recipient], [author]] = await Promise.all([getUserContacts([task.created_by]), getUserContacts([fromUserId])])
  if (recipient) await sendValidationRequestEmail(recipient.email, author ? `${author.first_name} ${author.last_name}` : 'Un collègue', task.title)
}

// Si la tâche est une étape confiée depuis la checklist d'une autre tâche, l'étape est
// cochée quand la tâche est terminée (décochée sinon), puis le statut du parent suit.
async function syncParentStep(taskId: number) {
  const [[task]] = await pool.query<RowDataPacket[]>('SELECT status FROM tasks WHERE id = ?', [taskId])
  const [[step]] = await pool.query<RowDataPacket[]>('SELECT id, task_id, done FROM task_checklist_items WHERE linked_task_id = ?', [taskId])
  if (!task || !step) return
  const done = task.status === 'termine'
  if (!!step.done === done) return
  await pool.query('UPDATE task_checklist_items SET done = ? WHERE id = ?', [done, step.id])
  await syncTaskStatusWithChecklist(step.task_id)
}

// Crée, met à jour ou supprime la tâche liée à une étape selon l'assignation demandée.
// Sans équipe ni personne, l'étape redevient une simple case à cocher.
async function assignChecklistItem(itemId: number, teamId: number | null, assigneeIds: number[], authorId: number) {
  const [[item]] = await pool.query<RowDataPacket[]>('SELECT * FROM task_checklist_items WHERE id = ?', [itemId])
  if (!item) return
  if (!teamId && assigneeIds.length === 0) {
    if (item.linked_task_id) {
      await pool.query('UPDATE task_checklist_items SET linked_task_id = NULL WHERE id = ?', [itemId])
      await pool.query('DELETE FROM tasks WHERE id = ?', [item.linked_task_id])
    }
    return
  }
  let linkedId: number = item.linked_task_id
  if (linkedId) {
    await pool.query('UPDATE tasks SET team_id = ? WHERE id = ?', [teamId || null, linkedId])
  } else {
    const [[parent]] = await pool.query<RowDataPacket[]>('SELECT * FROM tasks WHERE id = ?', [item.task_id])
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO tasks (project_name, team_id, lead_id, title, description, created_by, owner_id, priority, status, deadline)
       VALUES (?, ?, ?, ?, '', ?, NULL, ?, ?, ?)`,
      [parent.project_name, teamId || null, parent.lead_id, item.label, authorId, item.priority ?? parent.priority, item.done ? 'termine' : 'a_faire', item.deadline ?? parent.deadline]
    )
    linkedId = result.insertId
    await pool.query('UPDATE task_checklist_items SET linked_task_id = ? WHERE id = ?', [linkedId, itemId])
  }
  const newIds = await setAssignees(linkedId, assigneeIds)
  await notifyNewAssignees(linkedId, item.label, newIds, authorId)
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

// Visibilité des tâches (identique pour tous, admins compris) :
// - tâche personnelle (owner_id) : son propriétaire uniquement ;
// - tâche sans personne assignée (= confiée à toute l'équipe) : tout le monde — le front la
//   range dans l'espace de son équipe ;
// - tâche assignée à des personnes (avec ou sans équipe) : les assignés, son créateur, le
//   responsable de son équipe et celui de toute équipe dont un assigné est membre.
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const me = req.sdpUser!.id
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM tasks t
       WHERE t.owner_id = ?
          OR (t.owner_id IS NULL AND (
               NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)
               OR t.created_by = ?
               OR t.team_id IN (SELECT id FROM teams WHERE manager_user_id = ?)
               OR EXISTS (
                 SELECT 1 FROM task_assignees a
                 WHERE a.task_id = t.id AND (
                   a.user_id = ?
                   OR a.user_id IN (
                     SELECT tm.user_id FROM team_members tm JOIN teams tt ON tt.id = tm.team_id WHERE tt.manager_user_id = ?
                   )
                 )
               )
             ))
       ORDER BY t.deadline IS NULL, t.deadline`,
      [me, me, me, me, me]
    )
    res.json(await attachRelations(rows))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des tâches' })
  }
})

router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const { project_name, team_id, lead_id, title, description, assigned_to_ids, priority, color, start_date, deadline } = req.body
    if (!title) {
      res.status(400).json({ error: 'title est requis' })
      return
    }
    // Sans équipe, la tâche n'est personnelle (visible du seul créateur) que si personne
    // d'autre n'y est assigné — sinon les autres assignés ne la verraient jamais.
    const assignsOthers = Array.isArray(assigned_to_ids) && assigned_to_ids.some((id: number) => id !== req.sdpUser!.id)
    const ownerId = team_id || assignsOthers ? null : req.sdpUser!.id
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO tasks (project_name, team_id, lead_id, title, description, created_by, owner_id, priority, color, start_date, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [project_name?.trim() || null, team_id || null, lead_id || null, title.trim(), description ?? '', req.sdpUser!.id, ownerId, priority || 'moyenne', color || null, toMysqlDatetime(start_date), toMysqlDatetime(deadline)]
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

const PATCHABLE_FIELDS = ['title', 'description', 'project_name', 'lead_id', 'priority', 'color', 'status', 'start_date', 'deadline'] as const
const DATETIME_FIELDS = new Set(['start_date', 'deadline'])

router.put('/tasks/:id', async (req: Request, res: Response) => {
  try {
    // Seul le demandeur peut terminer une étape confiée ; pour les autres, "terminé" = demande de validation.
    let validationRequested = false
    if (req.body.status === 'termine' && (await isDelegatedStep(Number(req.params.id)))) {
      const [[current]] = await pool.query<RowDataPacket[]>('SELECT created_by, status FROM tasks WHERE id = ?', [req.params.id])
      if (current && current.created_by !== req.sdpUser!.id) {
        req.body.status = 'en_revision'
        validationRequested = current.status !== 'en_revision'
      }
    }
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
    // Assigner quelqu'un d'autre à une tâche personnelle la rend visible : elle cesse d'être personnelle.
    if (Array.isArray(req.body.assigned_to_ids)) {
      const [owners] = await pool.query<RowDataPacket[]>('SELECT owner_id FROM tasks WHERE id = ?', [req.params.id])
      const ownerId = owners[0]?.owner_id
      if (ownerId != null && req.body.assigned_to_ids.some((id: number) => id !== ownerId)) {
        await pool.query('UPDATE tasks SET owner_id = NULL WHERE id = ?', [req.params.id])
      }
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
    if (req.body.status !== undefined) await syncParentStep(Number(req.params.id))
    if (validationRequested) await requestValidation(Number(req.params.id), req.sdpUser!.id)
    if (req.body.deadline !== undefined || req.body.priority !== undefined) {
      await pool.query('UPDATE task_checklist_items SET deadline = ?, priority = ? WHERE linked_task_id = ?', [rows[0].deadline, rows[0].priority, req.params.id])
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

router.post('/tasks/:id/checklist', async (req: Request, res: Response) => {
  try {
    const { label, team_id, assigned_to_ids, deadline, priority } = req.body
    if (!label || typeof label !== 'string') {
      res.status(400).json({ error: 'label requis' })
      return
    }
    const [[{ count }]] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM task_checklist_items WHERE task_id = ?', [req.params.id]
    )
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO task_checklist_items (task_id, label, position, deadline, priority) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, label.trim(), count, toMysqlDatetime(deadline), priority || null]
    )
    await assignChecklistItem(result.insertId, team_id ?? null, Array.isArray(assigned_to_ids) ? assigned_to_ids : [], req.sdpUser!.id)
    await syncTaskStatusWithChecklist(Number(req.params.id))
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM task_checklist_items WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'ajout de l'item" })
  }
})

router.put('/tasks/:id/checklist/:itemId', async (req: Request, res: Response) => {
  try {
    const { label } = req.body
    let { done } = req.body
    // Cocher une étape confiée = la valider : réservé à qui l'a confiée. Pour les autres,
    // c'est une demande de validation (la tâche liée passe en révision, l'étape reste décochée).
    if (done) {
      const [[linked]] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.created_by, t.status FROM task_checklist_items c JOIN tasks t ON t.id = c.linked_task_id
         WHERE c.id = ? AND c.task_id = ?`,
        [req.params.itemId, req.params.id]
      )
      if (linked && linked.created_by !== req.sdpUser!.id) {
        done = undefined
        if (linked.status !== 'en_revision') {
          await pool.query("UPDATE tasks SET status = 'en_revision' WHERE id = ?", [linked.id])
          await requestValidation(linked.id, req.sdpUser!.id)
        }
      }
    }
    const fields: string[] = []
    const values: unknown[] = []
    if (done !== undefined) { fields.push('done = ?'); values.push(!!done) }
    if (label !== undefined) { fields.push('label = ?'); values.push(String(label).trim()) }
    if (req.body.deadline !== undefined) { fields.push('deadline = ?'); values.push(toMysqlDatetime(req.body.deadline)) }
    if (req.body.priority !== undefined) { fields.push('priority = ?'); values.push(req.body.priority || null) }
    if (fields.length > 0) {
      await pool.query(`UPDATE task_checklist_items SET ${fields.join(', ')} WHERE id = ? AND task_id = ?`, [...values, req.params.itemId, req.params.id])
    }
    const [[current]] = await pool.query<RowDataPacket[]>('SELECT linked_task_id FROM task_checklist_items WHERE id = ?', [req.params.itemId])
    if (current?.linked_task_id) {
      if (done !== undefined) {
        await pool.query(
          "UPDATE tasks SET status = CASE WHEN ? THEN 'termine' WHEN status = 'termine' THEN 'en_cours' ELSE status END WHERE id = ?",
          [!!done, current.linked_task_id]
        )
      }
      if (label !== undefined) await pool.query('UPDATE tasks SET title = ? WHERE id = ?', [String(label).trim(), current.linked_task_id])
      if (req.body.deadline !== undefined) await pool.query('UPDATE tasks SET deadline = ? WHERE id = ?', [toMysqlDatetime(req.body.deadline), current.linked_task_id])
      // La tâche liée a toujours une priorité : retirer celle de l'étape ne la modifie pas.
      if (req.body.priority) await pool.query('UPDATE tasks SET priority = ? WHERE id = ?', [req.body.priority, current.linked_task_id])
    }
    if (req.body.team_id !== undefined || req.body.assigned_to_ids !== undefined) {
      await assignChecklistItem(
        Number(req.params.itemId),
        req.body.team_id ?? null,
        Array.isArray(req.body.assigned_to_ids) ? req.body.assigned_to_ids : [],
        req.sdpUser!.id
      )
    }
    await syncTaskStatusWithChecklist(Number(req.params.id))
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM task_checklist_items WHERE id = ?', [req.params.itemId])
    if (!rows[0]) {
      res.status(404).json({ error: 'Item introuvable' })
      return
    }
    const [[task]] = await pool.query<RowDataPacket[]>('SELECT * FROM tasks WHERE id = ?', [req.params.id])
    res.json({ item: rows[0], task_status: task.status })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la mise à jour de l'item" })
  }
})

router.delete('/tasks/:id/checklist/:itemId', async (req: Request, res: Response) => {
  try {
    const [[item]] = await pool.query<RowDataPacket[]>(
      'SELECT linked_task_id FROM task_checklist_items WHERE id = ? AND task_id = ?', [req.params.itemId, req.params.id]
    )
    await pool.query('DELETE FROM task_checklist_items WHERE id = ? AND task_id = ?', [req.params.itemId, req.params.id])
    if (item?.linked_task_id) await pool.query('DELETE FROM tasks WHERE id = ?', [item.linked_task_id])
    await syncTaskStatusWithChecklist(Number(req.params.id))
    const [[task]] = await pool.query<RowDataPacket[]>('SELECT * FROM tasks WHERE id = ?', [req.params.id])
    res.json({ success: true, task_status: task.status })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la suppression de l'item" })
  }
})

export default router
