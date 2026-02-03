import {
  Controller,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { MediaS3StorageConfig } from '@waha/core/media/s3/MediaS3StorageConfig';
import { parseBool } from '@waha/helpers';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

@ApiSecurity('api_key')
@Controller('api/s3')
@ApiTags('S3')
export class S3Controller {
  private readonly client: S3Client;

  constructor(
    private cfg: MediaS3StorageConfig,
    @InjectPinoLogger(S3Controller.name) private readonly log: PinoLogger,
  ) {
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
    @Query('head') headRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const keyStr = Array.isArray(key) ? key.join('/') : String(key || '');
    const normalizedKey = keyStr.replace(/^\/+/, '');
    if (!normalizedKey) {
      throw new NotFoundException('Key is required');
    }

    // Signature verification is handled by AuthMiddleware - if request reaches here, it's authenticated.

    // Optional HEAD-only probe via ?head=true (useful for debugging)
    if (parseBool(headRaw)) {
      try {
        await this.client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: normalizedKey }),
        );
        res.status(200).end();
        return;
      } catch (err: any) {
        this.handleS3Error(err, bucket, normalizedKey, 'HEAD');
      }
    }

    let out: any;
    try {
      out = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: normalizedKey }),
      );
    } catch (err: any) {
      this.handleS3Error(err, bucket, normalizedKey, 'GET');
    }

    const contentType = out?.ContentType || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    if (out?.ContentLength) {
      res.setHeader('Content-Length', out.ContentLength);
    }
    // Cache for 5 minutes. This is shorter than the default URL TTL (15 min)
    // to allow re-fetches before signed URLs expire, while still reducing S3 load.
    res.setHeader('Cache-Control', 'private, max-age=300');

    const body = out?.Body;
    if (!body || typeof body.pipe !== 'function') {
      this.log.error({ bucket, key: normalizedKey }, 'S3 response body is not a readable stream');
      throw new InternalServerErrorException('Invalid S3 response');
    }

    // Handle stream errors to prevent silent truncation
    body.on('error', (err: Error) => {
      this.log.error({ err, bucket, key: normalizedKey }, 'S3 stream error during transfer');
      if (!res.headersSent) {
        res.status(500).end('Stream error');
      } else {
        res.destroy(err);
      }
    });

    body.pipe(res);
  }

  private handleS3Error(err: any, bucket: string, key: string, operation: string): never {
    const status = err?.$metadata?.httpStatusCode;
    const code = err?.name || err?.Code || err?.code;

    this.log.error(
      { err, bucket, key, status, code, operation },
      `S3 ${operation} operation failed`,
    );

    if (status === 404 || code === 'NotFound' || code === 'NoSuchKey') {
      throw new NotFoundException(`Object not found: ${bucket}/${key}`);
    }
    if (status === 403 || code === 'AccessDenied') {
      throw new ForbiddenException('Access denied to S3 object');
    }

    throw new InternalServerErrorException('Failed to retrieve object from S3');
  }
}
