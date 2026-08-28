import * as crypto from 'node:crypto';

export interface InterServiceSignaturePayload {
  secret: string;
  timestamp: number;
  method: string;
  path: string;
  body: string | Record<string, unknown>;
}

export function computeHmacSignature(payload: InterServiceSignaturePayload): string {
  const normalizedBody =
    typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body ?? {});
  const normalizedMethod = payload.method.toUpperCase();
  const normalizedPath = payload.path.startsWith('/') ? payload.path : `/${payload.path}`;
  const canonicalString = `${payload.timestamp}.${normalizedMethod}.${normalizedPath}.${normalizedBody}`;

  return crypto.createHmac('sha256', payload.secret).update(canonicalString).digest('hex');
}

export function verifyHmacSignature(params: {
  secret: string;
  signature: string;
  timestamp: number;
  method: string;
  path: string;
  body: string | Record<string, unknown>;
  maxDriftSeconds?: number;
  nowEpochSeconds?: number;
}): { valid: boolean; reason?: string } {
  const now = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const maxDrift = params.maxDriftSeconds ?? 300;

  if (Math.abs(now - params.timestamp) > maxDrift) {
    return { valid: false, reason: 'TIMESTAMP_EXPIRED' };
  }

  const expectedSignature = computeHmacSignature({
    secret: params.secret,
    timestamp: params.timestamp,
    method: params.method,
    path: params.path,
    body: params.body,
  });

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const actualBuffer = Buffer.from(params.signature, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  }

  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  }

  return { valid: true };
}
