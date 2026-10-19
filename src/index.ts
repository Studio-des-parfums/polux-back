import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { requireUser } from './middleware/requireUser'
import teamRoutes from './routes/teams'
import taskRoutes from './routes/tasks'
import attachmentRoutes from './routes/attachments'
import notificationRoutes from './routes/notifications'
import userRoutes from './routes/users'
import leadRoutes from './routes/leads'
import { startReminderCron } from './services/reminders'
import { startDeadlineAlertCron } from './services/deadlineAlerts'

const app = express()
const PORT = Number(process.env.PORT) || 3002

app.use(cors({ origin: '*' }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Toutes les routes /api nécessitent une identité valide (header x-user-email, vérifié
// contre la base sdp_dashboard — voir middleware/requireUser.ts).
app.use('/api', requireUser)
app.use('/api', teamRoutes)
app.use('/api', taskRoutes)
app.use('/api', attachmentRoutes)
app.use('/api', notificationRoutes)
app.use('/api', userRoutes)
app.use('/api', leadRoutes)

startReminderCron()
startDeadlineAlertCron()

app.listen(PORT, () => {
  console.log(`polux-back running on http://localhost:${PORT}`)
})
