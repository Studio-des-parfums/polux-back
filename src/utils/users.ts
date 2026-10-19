import { RowDataPacket } from 'mysql2'
import { sdpPool } from '../db'

export interface UserContact {
  id: number
  email: string
  first_name: string
  last_name: string
}

export async function getUserContacts(userIds: number[]): Promise<UserContact[]> {
  if (userIds.length === 0) return []
  const [rows] = await sdpPool.query<RowDataPacket[]>(
    'SELECT id, email, first_name, last_name FROM users WHERE id IN (?)',
    [userIds]
  )
  return rows as UserContact[]
}
