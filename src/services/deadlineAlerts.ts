import cron from 'node-cron'
import { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { sendDeadlineReminderEmail } from './email.js'
import { getUserContacts } from '../utils/users.js'

type AlertType = 'day_before' | 'due_day'

// Toutes les heures : envoie un email à chaque assigné d'une tâche dont l'échéance est
// demain (day_before) ou aujourd'hui (due_day). Pas d'email si personne n'est assigné
// (pour ne pas spammer le créateur) ni pour une tâche déjà terminée. Une table de suivi
// (task_deadline_alerts_sent) garantit qu'un même type d'alerte n'est envoyé qu'une fois
// par tâche, même si le cron tourne plusieurs fois le même jour.
export function startDeadlineAlertCron() {
  const run = async () => {
    try {
      await sendAlertsFor('due_day')
      await sendAlertsFor('day_before')
    } catch (err) {
      console.error('[deadline-alerts] erreur cron', err)
    }
  }
  run()
  cron.schedule('0 * * * *', run)
}

async function sendAlertsFor(type: AlertType) {
  const dayOffset = type === 'due_day' ? 0 : 1
  const [tasks] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.title
     FROM tasks t
     WHERE t.status <> 'termine'
       AND t.deadline IS NOT NULL
       AND DATE(t.deadline) = DATE(DATE_ADD(NOW(), INTERVAL ? DAY))
       AND NOT EXISTS (
         SELECT 1 FROM task_deadline_alerts_sent a WHERE a.task_id = t.id AND a.alert_type = ?
       )`,
    [dayOffset, type]
  )

  for (const task of tasks) {
    const [assignees] = await pool.query<RowDataPacket[]>('SELECT user_id FROM task_assignees WHERE task_id = ?', [task.id])
    if (assignees.length === 0) {
      // Pas d'assigné : on marque tout de même l'alerte comme traitée pour ne pas
      // la réévaluer en boucle, mais aucun email n'est envoyé.
      await pool.query('INSERT IGNORE INTO task_deadline_alerts_sent (task_id, alert_type) VALUES (?, ?)', [task.id, type])
      continue
    }

    const contacts = await getUserContacts(assignees.map((a) => a.user_id))
    for (const contact of contacts) {
      await sendDeadlineReminderEmail(contact.email, task.title, type === 'due_day')
      await pool.query(
        'INSERT INTO task_notifications (task_id, recipient_user_id, from_user_id) VALUES (?, ?, ?)',
        [task.id, contact.id, contact.id]
      )
    }
    await pool.query('INSERT IGNORE INTO task_deadline_alerts_sent (task_id, alert_type) VALUES (?, ?)', [task.id, type])
  }

  if (tasks.length > 0) console.log(`[deadline-alerts] ${tasks.length} tâche(s) traitée(s) pour ${type}`)
}
