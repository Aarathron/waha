import { Logger } from 'pino';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IMediaStorage, MediaData, getMetadata } from '@waha/core/media/IMediaStorage';
import { S3MediaData } from '@waha/structures/media.s3.dto';
import { MediaS3StorageConfig } from '@waha/core/media/s3/MediaS3StorageConfig';
import { signS3Proxy } from '@waha/core/media/s3/S3ProxySignature';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mime = require('mime-types');

function encodeS3KeyForPath(key: string): string {
  // Keep "/" as a path separator, but encode each segment safely.
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export class MediaS3Storage implements IMediaStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(
    protected log: Logger,
    private cfg: MediaS3StorageConfig,
  ) {
    this.bucket = cfg.bucket;
    if (!this.bucket) {
      throw new Error(
        `WAHA_MEDIA_STORAGE=S3 requires WAHA_S3_BUCKET to be set`,
      );
    }

    const credentials =
      cfg.accessKeyId && cfg.secretAccessKey
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined;

    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials,
      forcePathStyle: cfg.forcePathStyle,
    });
  }

  async init(): Promise<void> {
    return;
  }

  private getKey(data: MediaData): string {
    return `${data.session}/${data.message.id}.${data.file.extension}`;
  }

  async save(buffer: Buffer, data: MediaData): Promise<boolean> {
    const Key = this.getKey(data);
    const ContentType =
      mime.lookup(data.file.filename || `file.${data.file.extension}`) ||
      'application/octet-stream';
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key,
      Body: buffer,
      ContentType,
      Metadata: getMetadata(data),
    });

    try {
      await this.client.send(cmd);
      return true;
    } catch (err: any) {
      this.log.error(
        {
          err,
          bucket: this.bucket,
          key: Key,
          session: data.session,
          messageId: data.message.id,
        },
        'Failed to upload media to S3',
      );
      throw new Error(
        `Failed to save media to S3: ${err?.message || 'Unknown error'}. ` +
          `Session: ${data.session}, Message: ${data.message.id}`,
      );
    }
  }

  async exists(data: MediaData): Promise<boolean> {
    const Key = this.getKey(data);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key }),
      );
      return true;
    } catch (err: any) {
      // AWS SDK v3 errors have $metadata.httpStatusCode, but MinIO might differ.
      const status = err?.$metadata?.httpStatusCode;
      if (status === 404) {
        return false;
      }
      // Some S3 compatible providers throw "NotFound" name/code
      const code = err?.name || err?.Code || err?.code;
      if (code === 'NotFound' || code === 'NoSuchKey') {
        return false;
      }
      throw err;
    }
  }

  async getStorageData(data: MediaData): Promise<{ url: string; s3?: S3MediaData }> {
    const Bucket = this.bucket;
    const Key = this.getKey(data);

    const s3: S3MediaData = { Bucket, Key };

    // Prefer proxy URL so MinIO doesn't need to be publicly routable.
    if (this.cfg.proxyFiles) {
      const encodedKey = encodeS3KeyForPath(Key);
      let url = `${this.cfg.proxyBaseUrl}/${encodeURIComponent(Bucket)}/${encodedKey}`;

      const secret = this.cfg.proxyUrlSigningKey;
      if (secret) {
        const exp = Math.floor(Date.now() / 1000) + this.cfg.proxyUrlTtlSeconds;
        const sig = signS3Proxy({ bucket: Bucket, key: Key, exp, secret });
        url += `?exp=${exp}&sig=${sig}`;
      }

      return { url, s3 };
    }

    // Fall back to presigned URL. Note: requires the S3 endpoint to be reachable
    // from whoever will download the file.
    try {
      const presigned = await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket, Key }),
        { expiresIn: this.cfg.proxyUrlTtlSeconds },
      );
      return { url: presigned, s3 };
    } catch (err: any) {
      this.log.error(
        { err, bucket: Bucket, key: Key },
        'Failed to generate presigned URL',
      );
      throw new Error(
        `Failed to generate presigned URL for ${Bucket}/${Key}: ${err?.message || 'Unknown error'}`,
      );
    }
  }

  async purge(): Promise<void> {
    // Intentionally NOOP: deleting from an object store can be expensive and unsafe
    // without explicit configuration. Unlike LOCAL storage which purges on startup,
    // S3 storage skips purging - use S3 lifecycle policies for cleanup instead.
    this.log.info('S3 media storage purge skipped - use S3 lifecycle policies for cleanup');
    return;
  }

  async close(): Promise<void> {
    this.client.destroy();
  }
}

