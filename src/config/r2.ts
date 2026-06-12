import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

// Cloudflare R2 é S3-compatível. O endpoint usa o account id.
// Em dev as credenciais podem estar vazias — o client só falha ao ser usado.
const endpoint = env.R2_ACCOUNT_ID
  ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : undefined;

export const r2 = new S3Client({
  region: 'auto',
  ...(endpoint ? { endpoint } : {}),
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
  },
});

export const R2_BUCKET = env.R2_BUCKET;

/** Monta a URL pública de um objeto a partir do domínio configurado. */
export function r2PublicUrl(key: string): string | null {
  if (!env.R2_PUBLIC_URL) return null;
  return `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
}

/** Sobe um buffer para o R2 e devolve a chave + URL pública (se houver). */
export async function uploadBuffer(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ key: string; url: string | null }> {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
  return { key: input.key, url: r2PublicUrl(input.key) };
}
