import "dotenv/config";
import { ensureBucket, storageConfigured } from "../lib/storage";

if (!storageConfigured()) {
  console.log("S3_ENDPOINT not set; skipping bucket init");
} else {
  ensureBucket()
    .then(() => console.log(`Bucket "${process.env.S3_BUCKET || "checkly"}" ready`))
    .catch((e) => { console.error(e); process.exit(1); });
}
