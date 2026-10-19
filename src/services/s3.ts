import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Même bucket que sdp-dashboard/server/services/s3.ts (ateliers/, options/), préfixe
// dédié polux/ pour les pièces jointes de tâches. Contrairement à ateliers/ et options/,
// ce préfixe n'a pas de bucket policy publique — les fichiers peuvent être sensibles
// (documents internes), donc l'accès passe par une URL pré-signée à durée limitée
// plutôt que par une URL publique fixe.
const BUCKET = process.env.AWS_S3_BUCKET || ''
const REGION = process.env.AWS_S3_REGION || 'eu-west-3'
const PREFIX = 'polux/'
const SIGNED_URL_TTL_SECONDS = 3600

function getClient(): S3Client {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  })
}

export async function uploadTaskAttachment(
  taskId: number,
  fileBuffer: Buffer,
  originalFilename: string,
  contentType: string
): Promise<{ key: string }> {
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const key = `${PREFIX}${taskId}/${Date.now()}_${safeName}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  )

  return { key }
}

export async function getTaskAttachmentUrl(key: string): Promise<string> {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: SIGNED_URL_TTL_SECONDS })
}

export async function deleteTaskAttachment(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}
