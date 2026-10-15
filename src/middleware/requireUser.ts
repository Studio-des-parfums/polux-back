import { Request, Response, NextFunction } from 'express'
import { RowDataPacket } from 'mysql2'
import { sdpPool } from '../db'

export interface SdpUser {
  id: number
  email: string
  first_name: string
  last_name: string
  role_name: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sdpUser?: SdpUser
    }
  }
}

// Même mécanisme que sdp-dashboard/server (header x-user-email, pas de JWT dans ce
// système) — vérifié ici contre la base sdp_dashboard en lecture seule.
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const email = req.headers['x-user-email'] as string | undefined
    if (!email) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }

    const [rows] = await sdpPool.query<RowDataPacket[]>(
      `SELECT u.id, u.email, u.first_name, u.last_name, r.name as role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.email = ? AND u.is_active = TRUE`,
      [email]
    )
    const user = rows[0] as SdpUser | undefined
    if (!user) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }

    req.sdpUser = user
    next()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la vérification de l'identité" })
  }
}
