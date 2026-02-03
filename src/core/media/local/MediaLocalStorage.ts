import { IMediaStorage, MediaData } from '@waha/core/media/IMediaStorage';
import { SECOND } from '@waha/structures/enums.dto';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Logger } from 'pino';
import fs = require('fs');
import { fileExists } from '@waha/utils/files';
import { rimraf } from 'rimraf';
import { signS3Proxy } from '@waha/core/media/s3/S3ProxySignature';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const writeFileAtomic = require('write-file-atomic');

/**
 * Save files locally using the filesystem
 */
export class MediaLocalStorage implements IMediaStorage {
  private readonly lifetimeMs: number;
  private readonly urlSigningKey?: string;
  private readonly urlTtlSeconds: number;

  constructor(
    protected log: Logger,
    private filesFolder: string,
    private baseUrl: string,
    lifetimeSeconds: number,
    urlSigningKey: string | undefined,
    urlTtlSeconds: number,
  ) {
    this.lifetimeMs = lifetimeSeconds * SECOND;
    this.urlSigningKey = urlSigningKey;
    this.urlTtlSeconds = urlTtlSeconds;
    if (this.lifetimeMs === 0) {
      this.log.info('Files lifetime is 0, files will not be removed');
    }
  }

  async init() {
    return;
  }

  async exists(data: MediaData): Promise<boolean> {
    const filepath = this.getFullPath(data);
    return await fileExists(filepath);
  }

  public async save(buffer: Buffer, data: MediaData): Promise<boolean> {
    const filepath = this.getFullPath(data);
    const folder = path.dirname(filepath);
    await fsp.mkdir(folder, { recursive: true });
    await writeFileAtomic(filepath, buffer);
    this.postponeRemoval(filepath);
    return true;
  }

  public async getStorageData(data: MediaData) {
    const filename = this.getKey(data);
    let url = this.baseUrl + filename;
    const secret = this.urlSigningKey;
    if (secret) {
      const exp = Math.floor(Date.now() / 1000) + this.urlTtlSeconds;
      const sig = signS3Proxy({ bucket: 'files', key: filename, exp, secret });
      url += `?exp=${exp}&sig=${sig}`;
    }
    return { url };
  }

  async purge() {
    if (this.lifetimeMs === 0) {
      this.log.info('No need to purge files with lifetime 0');
      return;
    }

    if (fs.existsSync(this.filesFolder)) {
      // Use rimraf to delete all contents in the folder
      const pattern = `${this.filesFolder}/*`;
      try {
        await rimraf(pattern, { glob: true });
        this.log.info(`Purged files in: ${this.filesFolder}`);
      } catch (err) {
        this.log.error({ err, pattern }, 'Failed to purge files');
      }
    } else {
      fs.mkdirSync(this.filesFolder);
      this.log.info(`Directory '${this.filesFolder}' created from scratch`);
    }
  }

  private getKey(data: MediaData) {
    return `${data.session}/${data.message.id}.${data.file.extension}`;
  }

  private getFullPath(data: MediaData) {
    const filepath = this.getKey(data);
    return path.resolve(`${this.filesFolder}/${filepath}`);
  }

  private postponeRemoval(filepath: string) {
    if (this.lifetimeMs === 0) {
      return;
    }
    setTimeout(
      () =>
        fs.unlink(filepath, (err) => {
          if (err) {
            // ENOENT (file not found) is acceptable - file may have been manually deleted
            if (err.code !== 'ENOENT') {
              this.log.warn({ err, filepath }, 'Failed to remove file');
            }
          } else {
            this.log.info(`File ${filepath} was removed`);
          }
        }),
      this.lifetimeMs,
    );
  }

  async close() {
    return;
  }
}
