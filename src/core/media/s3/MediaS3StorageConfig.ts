import { Injectable } from '@nestjs/common';
import { WhatsappConfigService } from '@waha/config.service';
import { parseBool } from '@waha/helpers';

@Injectable()
export class MediaS3StorageConfig {
  public proxyUri = '/api/s3';

  constructor(private config: WhatsappConfigService) {}

  get bucket(): string {
    return this.config.get('WAHA_S3_BUCKET', '');
  }

  get region(): string {
    return this.config.get('WAHA_S3_REGION', 'us-east-1');
  }

  get endpoint(): string | undefined {
    return this.config.get('WAHA_S3_ENDPOINT', undefined);
  }

  get accessKeyId(): string | undefined {
    return this.config.get('WAHA_S3_ACCESS_KEY_ID', undefined);
  }

  get secretAccessKey(): string | undefined {
    return this.config.get('WAHA_S3_SECRET_ACCESS_KEY', undefined);
  }

  get forcePathStyle(): boolean {
    return parseBool(this.config.get('WAHA_S3_FORCE_PATH_STYLE', 'false'));
  }

  get proxyFiles(): boolean {
    return parseBool(this.config.get('WAHA_S3_PROXY_FILES', 'false'));
  }

  get proxyUrlSigningKey(): string | undefined {
    return this.config.get('WAHA_MEDIA_URL_SIGNING_KEY', undefined);
  }

  get proxyUrlTtlSeconds(): number {
    const raw = this.config.get('WAHA_MEDIA_URL_TTL_SECONDS', '900');
    const ttl = parseInt(raw, 10);
    // Protect from "0" or invalid values that would immediately expire.
    return Number.isFinite(ttl) && ttl > 0 ? ttl : 900;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get proxyBaseUrl(): string {
    return `${this.baseUrl}${this.proxyUri}`;
  }
}

