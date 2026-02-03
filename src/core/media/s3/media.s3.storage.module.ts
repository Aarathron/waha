import { Module } from '@nestjs/common';
import { WhatsappConfigService } from '@waha/config.service';
import { MediaS3StorageConfig } from '@waha/core/media/s3/MediaS3StorageConfig';
import { MediaS3StorageFactory } from '@waha/core/media/s3/MediaS3StorageFactory';

@Module({
  providers: [
    WhatsappConfigService,
    MediaS3StorageConfig,
    MediaS3StorageFactory,
  ],
  exports: [MediaS3StorageFactory, MediaS3StorageConfig],
})
export class MediaS3StorageModule {}
