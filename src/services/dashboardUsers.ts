// Accès aux utilisateurs via l'API interne de sdp-dashboard, seul service connecté à la
// base globale.
export interface SdpUser {
  id: number
  email: string
  first_name: string
  last_name: string
  role_name: string
}

export interface UserContact {
  id: number
  email: string
  first_name: string
  last_name: string
}

// requireUser s'exécute à chaque requête : ce cache court évite un appel HTTP par requête.
// Conséquence : un compte désactivé peut rester accepté jusqu'à 30 secondes.
const CACHE_TTL_MS = 30_000
const cache = new Map<string, { user: SdpUser; expiresAt: number }>()

async function dashboardGet(path: string): Promise<Response> {
  const baseUrl = process.env.DASHBOARD_API_URL
  const key = process.env.INTERNAL_API_KEY
  if (!baseUrl || !key) throw new Error('DASHBOARD_API_URL ou INTERNAL_API_KEY manquant')
  return fetch(`${baseUrl}/api/internal${path}`, {
    headers: { 'x-service-key': key },
    signal: AbortSignal.timeout(5000),
  })
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API dashboard : statut ${res.status}`)
  return (await res.json()) as T
}

export async function findActiveUserByEmail(email: string): Promise<SdpUser | null> {
  const cacheKey = email.toLowerCase()
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.user
  cache.delete(cacheKey)

  const res = await dashboardGet(`/users/by-email?email=${encodeURIComponent(email)}`)
  if (res.status === 404) return null
  const user = await readJson<SdpUser>(res)
  cache.set(cacheKey, { user, expiresAt: Date.now() + CACHE_TTL_MS })
  return user
}

export async function listActiveUsers(): Promise<UserContact[]> {
  return readJson<UserContact[]>(await dashboardGet('/users'))
}

export async function getUsersByIds(ids: number[]): Promise<UserContact[]> {
  if (ids.length === 0) return []
  return readJson<UserContact[]>(await dashboardGet(`/users?ids=${ids.join(',')}`))
}
