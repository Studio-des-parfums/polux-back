import { Router, Request, Response } from 'express'
import { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '../db.js'

const router = Router()

// mysql2 n'accepte pas le format ISO 8601 pour une colonne DATETIME — conversion en
// 'YYYY-MM-DD HH:MM:SS', même convention que tasks.ts.
function toMysqlDatetime(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ')
}

async function attachInteractions(leads: RowDataPacket[]) {
  if (leads.length === 0) return []
  const ids = leads.map((l) => l.id)
  const [interactions] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM lead_interactions WHERE lead_id IN (?) ORDER BY created_at',
    [ids]
  )
  return leads.map((l) => ({
    ...l,
    interactions: interactions.filter((i) => i.lead_id === l.id),
  }))
}

router.get('/leads', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM leads ORDER BY created_at DESC')
    res.json(await attachInteractions(rows))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la récupération des leads' })
  }
})

router.post('/leads', async (req: Request, res: Response) => {
  try {
    const {
      contact_type, last_name, first_name, phone, email, company, info,
      project_name, project_date, first_deposit_date, second_deposit_date,
      status, call_date, next_follow_up_at, assigned_to_id,
    } = req.body
    if (!last_name || !first_name || !phone || !call_date) {
      res.status(400).json({ error: 'Nom, prénom, numéro et date d\'appel sont requis' })
      return
    }
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO leads (contact_type, last_name, first_name, phone, email, company, info,
         project_name, project_date, first_deposit_date, second_deposit_date, status,
         call_date, next_follow_up_at, assigned_to_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contact_type || 'particulier', last_name.trim(), first_name.trim(), phone.trim(), email?.trim() || '',
        contact_type === 'professionnel' ? (company?.trim() || null) : null, info ?? '',
        project_name?.trim() || '', toMysqlDatetime(project_date), toMysqlDatetime(first_deposit_date), toMysqlDatetime(second_deposit_date),
        status || 'nouveau', toMysqlDatetime(call_date), toMysqlDatetime(next_follow_up_at), assigned_to_id || null, req.sdpUser!.id,
      ]
    )
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM leads WHERE id = ?', [result.insertId])
    res.status(201).json({ ...rows[0], interactions: [] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la création du lead' })
  }
})

const PATCHABLE_FIELDS = [
  'contact_type', 'last_name', 'first_name', 'phone', 'email', 'company', 'info',
  'project_name', 'project_date', 'first_deposit_date', 'second_deposit_date',
  'status', 'call_date', 'next_follow_up_at', 'assigned_to_id',
] as const
const DATETIME_FIELDS = new Set(['project_date', 'first_deposit_date', 'second_deposit_date', 'call_date', 'next_follow_up_at'])

router.put('/leads/:id', async (req: Request, res: Response) => {
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
      await pool.query(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`, [...values, req.params.id])
    }
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM leads WHERE id = ?', [req.params.id])
    if (!rows[0]) {
      res.status(404).json({ error: 'Lead introuvable' })
      return
    }
    const [withInteractions] = await attachInteractions(rows)
    res.json(withInteractions)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la mise à jour du lead' })
  }
})

router.delete('/leads/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM leads WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erreur lors de la suppression du lead' })
  }
})

router.post('/leads/:id/interactions', async (req: Request, res: Response) => {
  try {
    const { body } = req.body
    if (!body || typeof body !== 'string') {
      res.status(400).json({ error: 'body requis' })
      return
    }
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO lead_interactions (lead_id, author_id, body) VALUES (?, ?, ?)',
      [req.params.id, req.sdpUser!.id, body]
    )
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM lead_interactions WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'ajout de l'interaction" })
  }
})

router.get('/leads/access', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT user_id FROM leads_access')
    res.json(rows.map((r) => r.user_id))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la récupération de l'accès aux leads" })
  }
})

router.post('/leads/access', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.body
    if (!user_id) {
      res.status(400).json({ error: 'user_id requis' })
      return
    }
    await pool.query('INSERT IGNORE INTO leads_access (user_id) VALUES (?)', [user_id])
    res.status(201).json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de l'ajout de l'accès" })
  }
})

router.delete('/leads/access/:userId', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM leads_access WHERE user_id = ?', [req.params.userId])
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la suppression de l'accès" })
  }
})

export default router
