import { registerAs } from '@nestjs/config';

export const s3Config = registerAs('s3', () => ({
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  accessKey: process.env.STORAGE_ACCESS_KEY ?? 'woops',
  secretKey: process.env.STORAGE_SECRET_KEY ?? 'woops123',
  bucket: process.env.STORAGE_BUCKET ?? 'woops-assets',
  publicUrl: process.env.STORAGE_PUBLIC_URL ?? 'http://localhost:9000/woops-assets',
}));
