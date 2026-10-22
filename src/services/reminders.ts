import cron from 'node-cron'
import { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { notify } from './notify.js'

// Toutes les 5 minutes : envoie les rappels dont l'échéance est passée en créant une
// notification pour chaque assigné de la tâche (ou son créateur si personne n'est
// assigné), puis marque le rappel comme envoyé.
export function startReminderCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const [due] = await pool.query<RowDataPacket[]>(
        `SELECT r.id as reminder_id, t.id as task_id, t.title, t.created_by
         FROM task_reminders r
         JOIN tasks t ON t.id = r.task_id
         WHERE r.sent = FALSE AND r.remind_at <= NOW()`
      )

      for (const row of due) {
        const [assignees] = await pool.query<RowDataPacket[]>(
          'SELECT user_id FROM task_assignees WHERE task_id = ?',
          [row.task_id]
        )
        const recipients = assignees.length > 0 ? assignees.map((a) => a.user_id) : [row.created_by]
        await notify({
          taskId: row.task_id, type: 'reminder', recipientIds: recipients, fromUserId: null,
          message: `Rappel : « ${row.title} »`,
          email: { title: 'Rappel', taskTitle: row.title },
        })
        await pool.query('UPDATE task_reminders SET sent = TRUE WHERE id = ?', [row.reminder_id])
      }

      if (due.length > 0) console.log(`[reminders] ${due.length} rappel(s) envoyé(s)`)
    } catch (err) {
      console.error('[reminders] erreur cron', err)
    }
  })
}
