import { Request, Response, NextFunction } from 'express'
import { findActiveUserByEmail, type SdpUser } from '../services/dashboardUsers.js'

export type { SdpUser }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sdpUser?: SdpUser
    }
  }
}

// Même mécanisme que sdp-dashboard/server (header x-user-email, pas de JWT dans ce
// système) — vérifié via l'API interne de sdp-dashboard.
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const email = req.headers['x-user-email'] as string | undefined
    if (!email) {
      res.status(401).json({ error: 'Authentification requise' })
      return
    }

    const user = await findActiveUserByEmail(email)
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
