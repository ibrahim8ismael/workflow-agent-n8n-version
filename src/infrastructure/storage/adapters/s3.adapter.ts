import { S3Client } from '@aws-sdk/client-s3';

export class S3StorageAdapter {
  readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT,
      region: process.env.STORAGE_REGION,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
      },
      forcePathStyle: true,
    });
  }
}
