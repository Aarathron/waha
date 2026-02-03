import { Injectable } from '@nestjs/common';
import { WhatsappConfigService } from '@waha/config.service';

@Injectable()
export class MediaLocalStorageConfig {
  public filesUri = '/api/files';

  constructor(private config: WhatsappConfigService) {}

  get filesURL(): string {
    return `${this.config.baseUrl}${this.filesUri}/`;
  }

  get filesFolder(): string {
    return this.config.get('WHATSAPP_FILES_FOLDER', '/tmp/whatsapp-files');
  }

  get filesLifetime(): number {
    return parseInt(this.config.get('WHATSAPP_FILES_LIFETIME', '180'));
  }

  get urlSigningKey(): string | undefined {
    return this.config.get('WAHA_MEDIA_URL_SIGNING_KEY', undefined);
  }

  get urlTtlSeconds(): number {
    const raw = this.config.get('WAHA_MEDIA_URL_TTL_SECONDS', '900');
    const ttl = parseInt(raw, 10);
    return Number.isFinite(ttl) && ttl > 0 ? ttl : 900;
  }
}
