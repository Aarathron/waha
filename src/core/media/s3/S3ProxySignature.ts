import { createHmac, timingSafeEqual } from 'node:crypto';

export interface S3ProxySignatureInput {
  bucket: string;
  key: string;
  exp: number;
  secret: string;
}

function baseString(input: Omit<S3ProxySignatureInput, 'secret'>): string {
  // Keep format stable across callers.
  // Newlines avoid accidental ambiguity.
  return `${input.bucket}\n${input.key}\n${input.exp}`;
}

export function signS3Proxy(input: S3ProxySignatureInput): string {
  return createHmac('sha256', input.secret)
    .update(baseString(input))
    .digest('hex');
}

export function verifyS3Proxy(input: S3ProxySignatureInput, sig: string): boolean {
  const expected = signS3Proxy(input);
  if (!sig) {
    return false;
  }
  if (sig.length !== expected.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

