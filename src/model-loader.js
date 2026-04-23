import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';

const s3 = new S3Client();
const MODEL_DIR = '/tmp/model';

export async function ensureModelLoaded() {
  const bucket = process.env.MODEL_BUCKET;
  const prefix = process.env.MODEL_PREFIX;

  if (!bucket || !prefix) {
    throw new Error('MODEL_BUCKET and MODEL_PREFIX environment variables are required');
  }

  // Check if model already cached (warm invocation)
  const markerPath = join(MODEL_DIR, '.download-complete');
  if (existsSync(markerPath)) {
    console.log('Model already cached in /tmp');
    return MODEL_DIR;
  }

  console.log(`Downloading model from s3://${bucket}/${prefix}/...`);
  mkdirSync(MODEL_DIR, { recursive: true });

  // List all model files in S3
  const files = await listModelFiles(bucket, prefix);
  console.log(`Found ${files.length} model files to download`);

  // Download all files
  for (const key of files) {
    const relativePath = key.slice(prefix.length + 1); // remove prefix/
    const localPath = join(MODEL_DIR, relativePath);

    // Create subdirectories if needed
    const dir = localPath.substring(0, localPath.lastIndexOf('/'));
    if (dir) mkdirSync(dir, { recursive: true });

    await downloadFile(bucket, key, localPath);
  }

  // Mark download as complete
  createWriteStream(markerPath).end();
  console.log('Model download complete');

  return MODEL_DIR;
}

async function listModelFiles(bucket, prefix) {
  const files = [];
  let continuationToken;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${prefix}/`,
      ContinuationToken: continuationToken,
    });

    const response = await s3.send(command);
    if (response.Contents) {
      for (const obj of response.Contents) {
        // Skip directory markers
        if (!obj.Key.endsWith('/')) {
          files.push(obj.Key);
        }
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return files;
}

async function downloadFile(bucket, key, localPath) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(command);

  const writeStream = createWriteStream(localPath);
  await pipeline(response.Body, writeStream);
}
