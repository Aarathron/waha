import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { WhatsappConfigService } from '@waha/config.service';
import { MediaLocalStorageConfig } from '@waha/core/media/local/MediaLocalStorageConfig';
import { MediaLocalStorageFactory } from '@waha/core/media/local/MediaLocalStorageFactory';

@Module({
  imports: [
    ServeStaticModule.forRootAsync({
      imports: [],
      extraProviders: [MediaLocalStorageConfig, WhatsappConfigService],
      inject: [MediaLocalStorageConfig],
      useFactory: (config: MediaLocalStorageConfig) => {
        return [
          {
            rootPath: config.filesFolder,
            serveRoot: config.filesUri,
          },
        ];
      },
    }),
  ],
  providers: [
    MediaLocalStorageFactory,
    WhatsappConfigService,
    MediaLocalStorageConfig,
  ],
  exports: [MediaLocalStorageFactory],
})
export class MediaLocalStorageModule {}
