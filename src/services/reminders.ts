import cron from 'node-cron'
import { RowDataPacket } from 'mysql2'
import { pool } from '../db'

// Toutes les 5 minutes : envoie les rappels dont l'échéance est passée en créant une
// notification pour l'assigné de la tâche, puis marque le rappel comme envoyé.
export function startReminderCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const [due] = await pool.query<RowDataPacket[]>(
        `SELECT r.id as reminder_id, t.id as task_id, t.assigned_to, t.created_by
         FROM task_reminders r
         JOIN tasks t ON t.id = r.task_id
         WHERE r.sent = FALSE AND r.remind_at <= NOW()`
      )

      for (const row of due) {
        const recipient = row.assigned_to ?? row.created_by
        await pool.query(
          'INSERT INTO task_notifications (task_id, recipient_user_id, from_user_id) VALUES (?, ?, ?)',
          [row.task_id, recipient, row.created_by]
        )
        await pool.query('UPDATE task_reminders SET sent = TRUE WHERE id = ?', [row.reminder_id])
      }

      if (due.length > 0) console.log(`[reminders] ${due.length} rappel(s) envoyé(s)`)
    } catch (err) {
      console.error('[reminders] erreur cron', err)
    }
  })
}
