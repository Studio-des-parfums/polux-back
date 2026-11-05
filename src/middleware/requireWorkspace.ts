import { Request, Response, NextFunction } from 'express'
import { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { hasProjectAccess } from '../services/dashboardUsers.js'

export interface Workspace {
  id: number
  slug: string
  name: string
  color: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspace?: Workspace
    }
  }
}

// Espace par défaut quand le client n'envoie pas de header (anciens clients, messagerie).
export const DEFAULT_WORKSPACE_SLUG = 'polux'

// Résout l'espace Polux demandé (header x-polux-workspace = slug) et vérifie que l'utilisateur
// y a accès : admin, ou accès au projet sdp_dashboard de même slug.
export async function requireWorkspace(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = (req.headers['x-polux-workspace'] as string | undefined) || DEFAULT_WORKSPACE_SLUG
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, slug, name, color FROM workspaces WHERE slug = ?', [slug])
    const workspace = rows[0] as Workspace | undefined
    if (!workspace) {
      res.status(404).json({ error: 'Espace Polux introuvable' })
      return
    }
    const user = req.sdpUser!
    if (user.role_name !== 'admin' && !(await hasProjectAccess(user.id, workspace.slug))) {
      res.status(403).json({ error: 'Accès non autorisé à cet espace' })
      return
    }
    req.workspace = workspace
    next()
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Erreur lors de la vérification de l'espace" })
  }
}

// Vérifie qu'une ressource identifiée par :id appartient à l'espace courant (sinon 404),
// pour qu'on ne puisse jamais lire ou modifier une tâche/équipe/lead d'un autre espace.
export function belongsToWorkspace(table: 'tasks' | 'teams' | 'leads') {
  return async (req: Request, res: Response, next: NextFunction, id: string) => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT 1 FROM ${table} WHERE id = ? AND workspace_id = ?`, [id, req.workspace!.id])
      if (rows.length === 0) {
        res.status(404).json({ error: 'Introuvable dans cet espace' })
        return
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
