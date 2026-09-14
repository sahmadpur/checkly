import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const env = () => ({
  endpoint: process.env.S3_ENDPOINT,
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  bucket: process.env.S3_BUCKET || "checkly",
  accessKeyId: process.env.S3_ACCESS_KEY || "",
  secretAccessKey: process.env.S3_SECRET_KEY || "",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

export const storageConfigured = () => !!process.env.S3_ENDPOINT;

function client(endpoint: string | undefined) {
  const e = env();
  return new S3Client({
    endpoint, region: e.region, forcePathStyle: e.forcePathStyle,
    credentials: { accessKeyId: e.accessKeyId, secretAccessKey: e.secretAccessKey },
  });
}

let internal: S3Client | undefined;
let publicClient: S3Client | undefined;
const internalClient = () => (internal ??= client(env().endpoint));
const presignClient = () => (publicClient ??= client(env().publicEndpoint));

/** Presigned PUT. The signature binds content type and exact length, so an oversized upload is refused by storage. */
export async function presignUpload(p: { key: string; contentType: string; contentLength: number; expiresSec: number }) {
  const cmd = new PutObjectCommand({ Bucket: env().bucket, Key: p.key, ContentType: p.contentType, ContentLength: p.contentLength });
  return getSignedUrl(presignClient(), cmd, { expiresIn: p.expiresSec, signableHeaders: new Set(["content-type", "content-length"]) });
}

export async function presignDownload(key: string, expiresSec = 900) {
  return getSignedUrl(presignClient(), new GetObjectCommand({ Bucket: env().bucket, Key: key }), { expiresIn: expiresSec });
}

export async function deleteObject(key: string) {
  await internalClient().send(new DeleteObjectCommand({ Bucket: env().bucket, Key: key }));
}

export async function ensureBucket() {
  const c = internalClient();
  const Bucket = env().bucket;
  try {
    await c.send(new HeadBucketCommand({ Bucket }));
  } catch {
    await c.send(new CreateBucketCommand({ Bucket }));
  }
}
