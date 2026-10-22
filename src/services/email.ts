import { Resend } from 'resend'

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@sdp-paris.com'
const from = `Polux <${FROM_EMAIL}>`
const APP_URL = process.env.POLUX_APP_URL || 'https://main.d1e2pr3r9i0qy0.amplifyapp.com/project/polux'

// Charte du site (tailwind.config.js, tokens "indigo") : marron/beige chaud, pas de
// violet/bleu générique — même teinte que le reste de sdp-dashboard.
const BRAND = '#996F56'
const BRAND_LIGHT = '#BC8F6B'

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn('RESEND_API_KEY not set — emails will not be sent')
    return null
  }
  return new Resend(key)
}

function layout(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #FAFAFA; color: #2B211B; border-radius: 12px; border: 1px solid #EAE2D9;">
      <p style="color: ${BRAND}; font-size: 13px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin: 0 0 8px;">Polux</p>
      <h1 style="color: #2B211B; font-size: 20px; margin: 0 0 16px;">${title}</h1>
      ${bodyHtml}
      <a href="${APP_URL}" style="display: inline-block; margin-top: 20px; background: ${BRAND}; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;">
        Ouvrir Polux
      </a>
      <p style="color: #9A8573; font-size: 12px; margin-top: 24px;">
        Notification automatique de Polux — vous recevez cet email car vous êtes concerné par cette tâche.
      </p>
    </div>
  `
}

function taskLine(taskTitle: string): string {
  return `<div style="background: #F5F0EA; border: 1px solid #EAE2D9; border-left: 3px solid ${BRAND_LIGHT}; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
    <p style="color: #2B211B; font-size: 15px; font-weight: 600; margin: 0;">${taskTitle}</p>
  </div>`
}

export async function sendMentionEmail(to: string, fromName: string, taskTitle: string, commentBody: string) {
  const resend = getClient()
  if (!resend) return
  try {
    await resend.emails.send({
      from,
      to,
      subject: `${fromName} vous a mentionné sur "${taskTitle}"`,
      html: layout('Vous avez été mentionné', `
        <p style="color: #5D4C3F; font-size: 14px; line-height: 1.6;"><strong style="color: #2B211B;">${fromName}</strong> vous a mentionné dans un commentaire :</p>
        ${taskLine(taskTitle)}
        <p style="color: #5D4C3F; font-size: 14px; line-height: 1.6; font-style: italic;">« ${commentBody} »</p>
      `),
    })
  } catch (err) {
    console.error('sendMentionEmail failed', err)
  }
}

export async function sendAssignedEmail(to: string, fromName: string, taskTitle: string) {
  const resend = getClient()
  if (!resend) return
  try {
    await resend.emails.send({
      from,
      to,
      subject: `${fromName} vous a assigné la tâche "${taskTitle}"`,
      html: layout('Nouvelle tâche assignée', `
        <p style="color: #5D4C3F; font-size: 14px; line-height: 1.6;"><strong style="color: #2B211B;">${fromName}</strong> vous a assigné :</p>
        ${taskLine(taskTitle)}
      `),
    })
  } catch (err) {
    console.error('sendAssignedEmail failed', err)
  }
}

export async function sendValidationRequestEmail(to: string, fromName: string, taskTitle: string) {
  const resend = getClient()
  if (!resend) return
  try {
    await resend.emails.send({
      from,
      to,
      subject: `${fromName} demande la validation de "${taskTitle}"`,
      html: layout('Validation demandée', `
        <p style="color: #5D4C3F; font-size: 14px; line-height: 1.6;"><strong style="color: #2B211B;">${fromName}</strong> a terminé l'étape que vous lui avez confiée et attend votre validation :</p>
        ${taskLine(taskTitle)}
      `),
    })
  } catch (err) {
    console.error('sendValidationRequestEmail failed', err)
  }
}

export async function sendDeadlineReminderEmail(to: string, taskTitle: string, isToday: boolean) {
  const resend = getClient()
  if (!resend) return
  try {
    await resend.emails.send({
      from,
      to,
      subject: isToday ? `Échéance aujourd'hui : "${taskTitle}"` : `Échéance demain : "${taskTitle}"`,
      html: layout(isToday ? "L'échéance est aujourd'hui" : "L'échéance est demain", `
        <p style="color: #5D4C3F; font-size: 14px; line-height: 1.6;">
          ${isToday ? "Cette tâche arrive à échéance aujourd'hui :" : "Cette tâche arrive à échéance demain :"}
        </p>
        ${taskLine(taskTitle)}
      `),
    })
  } catch (err) {
    console.error('sendDeadlineReminderEmail failed', err)
  }
}
