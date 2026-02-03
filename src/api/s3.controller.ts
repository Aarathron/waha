import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { MediaS3StorageConfig } from '@waha/core/media/s3/MediaS3StorageConfig';
import { verifyS3Proxy } from '@waha/core/media/s3/S3ProxySignature';
import { parseBool } from '@waha/helpers';

@ApiSecurity('api_key')
@Controller('api/s3')
@ApiTags('🗄️ S3')
export class S3Controller {
  private readonly client: S3Client;

  constructor(private cfg: MediaS3StorageConfig) {
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

  @Get(':bucket/*key')
  @ApiOperation({
    summary: 'Proxy a stored media file from S3/MinIO',
    description:
      'Useful when the S3/MinIO endpoint is not publicly routable. Can be optionally accessed via a signed URL (WAHA_MEDIA_URL_SIGNING_KEY).',
  })
  async getObject(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query('exp') expRaw: string | undefined,
    @Query('sig') sig: string | undefined,
    @Query('head') headRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const keyStr = Array.isArray(key) ? key.join('/') : String(key || '');
    const normalizedKey = keyStr.replace(/^\/+/, '');
    if (!normalizedKey) {
      throw new NotFoundException();
    }

    const hasApiKeyHeader = Boolean(res.req?.headers?.['x-api-key']);
    const secret = this.cfg.proxyUrlSigningKey;
    if (secret && !hasApiKeyHeader) {
      const exp = parseInt(String(expRaw || ''), 10);
      const now = Math.floor(Date.now() / 1000);
      const ok =
        Number.isFinite(exp) &&
        exp > now &&
        Boolean(sig) &&
        verifyS3Proxy({ bucket, key: normalizedKey, exp, secret }, String(sig));
      if (!ok) {
        throw new NotFoundException();
      }
    }

    // Optional HEAD-only probe via ?head=true (useful for debugging)
    if (parseBool(headRaw)) {
      try {
        await this.client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: normalizedKey }),
        );
        res.status(200).end();
        return;
      } catch {
        throw new NotFoundException();
      }
    }

    let out: any;
    try {
      out = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: normalizedKey }),
      );
    } catch {
      throw new NotFoundException();
    }

    const contentType = out?.ContentType || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    // Allow caching for a short period; signed URLs already expire.
    res.setHeader('Cache-Control', 'private, max-age=300');

    const body = out?.Body;
    if (!body || typeof body.pipe !== 'function') {
      throw new NotFoundException();
    }
    body.pipe(res);
  }
}
