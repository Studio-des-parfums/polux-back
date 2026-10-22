import type { Server as HttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { RowDataPacket } from 'mysql2'
import { sdpPool } from '../db.js'

// Temps réel des notifications Polux : chaque onglet ouvert se connecte avec l'email de
// l'utilisateur (même identité que le header x-user-email), et rejoint la room "user:<id>".
let io: SocketIOServer | null = null

export function initSocket(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, { cors: { origin: '*' } })
  io.on('connection', async (socket) => {
    const email = socket.handshake.auth?.email
    if (!email || typeof email !== 'string') {
      socket.disconnect(true)
      return
    }
    try {
      const [rows] = await sdpPool.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ? AND is_active = TRUE', [email])
      if (!rows[0]) {
        socket.disconnect(true)
        return
      }
      socket.join(`user:${rows[0].id}`)
    } catch (err) {
      console.error('[socket] connexion refusée', err)
      socket.disconnect(true)
    }
  })
}

export function emitToUser(userId: number, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload)
}
