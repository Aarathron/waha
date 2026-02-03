import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaStorageFactory } from '@waha/core/media/MediaStorageFactory';
import { MediaLocalStorageFactory } from '@waha/core/media/local/MediaLocalStorageFactory';
import { MediaLocalStorageModule } from '@waha/core/media/local/media.local.storage.module';
import { MediaS3StorageFactory } from '@waha/core/media/s3/MediaS3StorageFactory';
import { MediaS3StorageModule } from '@waha/core/media/s3/media.s3.storage.module';

@Module({
  imports: [MediaLocalStorageModule, MediaS3StorageModule],
  providers: [
    {
      provide: MediaStorageFactory,
      useFactory: (
        config: ConfigService,
        localFactory: MediaLocalStorageFactory,
        s3Factory: MediaS3StorageFactory,
      ) => {
        const storage = config.get<string>('WAHA_MEDIA_STORAGE', 'LOCAL');
        return storage === 'S3' ? s3Factory : localFactory;
      },
      inject: [ConfigService, MediaLocalStorageFactory, MediaS3StorageFactory],
    },
  ],
  exports: [MediaStorageFactory, MediaS3StorageModule],
})
export class MediaStorageModule {}
