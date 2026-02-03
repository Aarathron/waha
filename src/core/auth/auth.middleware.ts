import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { WhatsappConfigService } from '@waha/config.service';
import { verifyS3Proxy } from '@waha/core/media/s3/S3ProxySignature';
import passport from 'passport';

import { IApiKeyAuth } from './auth';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private auth: IApiKeyAuth,
    private config: WhatsappConfigService,
  ) {}

  private isValidSignedMediaProxyRequest(req: any): boolean {
    const secret = this.config.get('WAHA_MEDIA_URL_SIGNING_KEY', undefined);
    if (!secret) {
      return false;
    }

    const rawUrl: string = req?.path || req?.originalUrl || req?.url || '';
    const pathname = rawUrl.split('?')[0];
    // When middleware is mounted for the "api" route, Express may pass the URL
    // without the "/api" prefix (e.g. "/files/..."). Normalize for signature checks.
    const fullPathname = pathname.startsWith('/api/')
      ? pathname
      : `/api${pathname}`;

    const isS3 = fullPathname.startsWith('/api/s3/');
    const isFiles = fullPathname.startsWith('/api/files/');
    if (!isS3 && !isFiles) {
      return false;
    }

    const expRaw = req?.query?.exp;
    const sig = req?.query?.sig;
    // Validate types to prevent array injection (e.g., ?exp=1&exp=2)
    if (typeof expRaw !== 'string' || typeof sig !== 'string' || !expRaw || !sig) {
      return false;
    }

    const exp = parseInt(expRaw, 10);
    if (!Number.isFinite(exp)) {
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    if (exp <= now) {
      return false;
    }

    if (isS3) {
      const rest = fullPathname.slice('/api/s3/'.length);
      const parts = rest.split('/').filter(Boolean);
      if (parts.length < 2) {
        return false;
      }
      const bucket = decodeURIComponent(parts[0]);
      const key = parts
        .slice(1)
        .map((p) => decodeURIComponent(p))
        .join('/');
      return verifyS3Proxy({ bucket, key, exp, secret }, sig);
    }

    // Local /api/files/<key> (served by static middleware)
    const key = fullPathname
      .slice('/api/files/'.length)
      .split('/')
      .filter(Boolean)
      .map((p) => decodeURIComponent(p))
      .join('/');
    if (!key) {
      return false;
    }
    return verifyS3Proxy({ bucket: 'files', key, exp, secret }, sig);
  }

  use(req: any, res: any, next: () => void) {
    // Skip authentication if auth says so
    if (this.auth.skipAuth()) {
      next();
      return;
    }

    // Allow signed /api/s3/... URLs to be fetched without API key headers.
    // This is needed for systems that can't add custom headers (e.g. WhatsApp link-preview fetchers).
    if (this.isValidSignedMediaProxyRequest(req)) {
      next();
      return;
    }

    passport.authenticate('headerapikey', { session: false }, (value) => {
      if (!value) {
        throw new UnauthorizedException();
      }
      next();
    })(req, res, next);
  }
}
