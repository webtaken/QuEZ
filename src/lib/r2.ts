import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let cached: S3Client | null = null
function client(): S3Client {
  if (cached) return cached
  cached = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  return cached
}

// Object key: namespaced by user so presigned URLs and cleanup stay scoped.
export function r2Key(userId: string, attachmentId: string, filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, '_').slice(-120)
  return `attachments/${userId}/${attachmentId}/${safe}`
}

export async function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, ContentType: contentType }),
    { expiresIn: 600 }
  )
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const out = await client().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }))
  // aws-sdk v3 attaches transformToByteArray() to the Node stream Body.
  return (out.Body as unknown as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray()
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (!keys.length) return
  await client().send(
    new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET!,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    })
  )
}
