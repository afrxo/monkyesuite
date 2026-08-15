// Cloudflare R2 client for card-attachment storage. R2 is S3-compatible, so
// the AWS SDK works against its endpoint. Presigned URLs let the browser upload
// directly (bypassing the API request body) and download without proxying.
//
// Env:
//   R2_ACCOUNT_ID       — Cloudflare account id
//   R2_ACCESS_KEY_ID    — R2 API token id
//   R2_SECRET_ACCESS_KEY — R2 API token secret
//   R2_BUCKET           — bucket name
//   R2_PUBLIC_URL_BASE  — optional public base for image thumbnails via
//                         Cloudflare Images URL transforms; when unset,
//                         thumbnails fall back to presigned GETs at read time.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PUT_TTL_SECONDS = 60;
const GET_TTL_SECONDS = 300;

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const accountId = required("R2_ACCOUNT_ID");
  const accessKeyId = required("R2_ACCESS_KEY_ID");
  const secretAccessKey = required("R2_SECRET_ACCESS_KEY");
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

function bucket(): string {
  return required("R2_BUCKET");
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SAFE_NAME = /[^A-Za-z0-9._-]+/g;

export function buildAttachmentKey(
  taskId: string,
  attachmentId: string,
  fileName: string,
): string {
  const safe = fileName.replace(SAFE_NAME, "_").slice(0, 200) || "file";
  return `tasks/${taskId}/${attachmentId}/${safe}`;
}

export async function presignPutUrl(
  key: string,
  mimeType: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: mimeType,
  });
  const url = await getSignedUrl(getClient(), cmd, {
    expiresIn: PUT_TTL_SECONDS,
  });
  return { url, expiresInSeconds: PUT_TTL_SECONDS };
}

export async function presignGetUrl(
  key: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: key });
  const url = await getSignedUrl(getClient(), cmd, {
    expiresIn: GET_TTL_SECONDS,
  });
  return { url, expiresInSeconds: GET_TTL_SECONDS };
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
  );
}

// Best-effort thumbnail URL for images. Uses the Cloudflare Images URL
// transform pattern on the public bucket base, when configured. Callers fall
// back to null → the grid renders the mono badge.
export function thumbnailUrlFor(
  mimeType: string,
  key: string,
): string | null {
  const base = process.env.R2_PUBLIC_URL_BASE;
  if (!base) return null;
  if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
    return null;
  }
  // /cdn-cgi/image/width=160,height=160,fit=cover/<origin>/<key>
  return `${base.replace(/\/$/, "")}/cdn-cgi/image/width=160,height=160,fit=cover/${key}`;
}
