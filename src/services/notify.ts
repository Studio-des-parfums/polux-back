import cron from 'node-cron'
import { pool } from '../db.js'
import { getUserContacts } from '../utils/users.js'
import { sendNotificationEmail } from './email.js'
import { emitToUser } from './socket.js'

export type NotificationType =
  | 'assigned'
  | 'team_task'
  | 'status_change'
  | 'validation_request'
  | 'mention'
  | 'deadline'
  | 'reminder'

export const NOTIFICATION_RETENTION_DAYS = 30

interface NotifyInput {
  taskId: number
  type: NotificationType
  recipientIds: number[]
  /** Auteur de l'action — jamais notifié lui-même. Null pour une notification automatique. */
  fromUserId: number | null
  /** Texte de la notification (cloche) ; sert aussi d'objet d'email. */
  message: string
  /** Si fourni, un email est envoyé à chaque destinataire. */
  email?: { title: string; taskTitle: string; details?: string }
  commentId?: number
}

// Point d'entrée unique des notifications Polux : enregistre la notification (cloche) et
// envoie l'email correspondant à chaque personne concernée, sauf à l'auteur de l'action.
export async function notify({ taskId, type, recipientIds, fromUserId, message, email, commentId }: NotifyInput) {
  const recipients = [...new Set(recipientIds)].filter((id) => id !== fromUserId)
  if (recipients.length === 0) return
  for (const userId of recipients) {
    await pool.query(
      'INSERT INTO task_notifications (task_id, comment_id, recipient_user_id, from_user_id, type, message) VALUES (?, ?, ?, ?, ?, ?)',
      [taskId, commentId ?? null, userId, fromUserId, type, message.slice(0, 500)]
    )
    // Temps réel : la cloche du destinataire se met à jour sans rechargement.
    emitToUser(userId, 'notification', { task_id: taskId, type, message })
  }
  if (!email) return
  const contacts = await getUserContacts(recipients)
  for (const contact of contacts) {
    await sendNotificationEmail(contact.email, { subject: message, ...email })
  }
}

export async function userName(userId: number | null): Promise<string> {
  if (!userId) return 'Polux'
  const [contact] = await getUserContacts([userId])
  return contact ? `${contact.first_name} ${contact.last_name}` : 'Un collègue'
}

// Purge quotidienne (3h) : les notifications ne sont conservées que 30 jours.
export function startNotificationCleanupCron() {
  const run = async () => {
    try {
      await pool.query('DELETE FROM task_notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [NOTIFICATION_RETENTION_DAYS])
    } catch (err) {
      console.error('[notifications] erreur purge', err)
    }
  }
  run()
  cron.schedule('0 3 * * *', run)
}
