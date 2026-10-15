import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

// Même bucket que sdp-dashboard/server/services/s3.ts (ateliers/, options/), préfixe
// dédié polux/ pour les pièces jointes de tâches.
const BUCKET = process.env.AWS_S3_BUCKET || ''
const REGION = process.env.AWS_S3_REGION || 'eu-west-3'
const PREFIX = 'polux/'

function getClient(): S3Client {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  })
}

function publicUrl(key: string): string {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`
}

export async function uploadTaskAttachment(
  taskId: number,
  fileBuffer: Buffer,
  originalFilename: string,
  contentType: string
): Promise<{ key: string; url: string }> {
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

  return { key, url: publicUrl(key) }
}

export async function deleteTaskAttachment(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}
