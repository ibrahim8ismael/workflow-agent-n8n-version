import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { computeHmacSignature } from '../../infrastructure/auth/inter-service-crypto';
import {
  HEADER_INTERNAL_KEY,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  InterServiceAuthGuard,
} from './inter-service-auth.guard';

describe('InterServiceAuthGuard', () => {
  const secret = 'super-secret-key-1234567890';
  const now = Math.floor(Date.now() / 1000);

  const mockConfig = (values: Record<string, unknown> = {}) => ({
    get: vi.fn(
      (key: string) => values[key] ?? (key === 'WOOPS_INTER_SERVICE_SECRET' ? secret : undefined),
    ),
  });

  const mockContext = (
    headers: Record<string, string>,
    body: Record<string, unknown> = {},
    method = 'POST',
    url = '/api/v1/channels/inbound',
  ) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        body,
        method,
        url,
        originalUrl: url,
      }),
    }),
  });

  it('allows access with valid HMAC-SHA256 signature and timestamp', () => {
    const body = { test: 'payload' };
    const signature = computeHmacSignature({
      secret,
      timestamp: now,
      method: 'POST',
      path: '/api/v1/channels/inbound',
      body,
    });

    const guard = new InterServiceAuthGuard(mockConfig() as never);
    const context = mockContext(
      {
        [HEADER_SIGNATURE]: `sha256=${signature}`,
        [HEADER_TIMESTAMP]: String(now),
      },
      body,
    );

    expect(guard.canActivate(context as never)).toBe(true);
  });

  it('allows access when matching internal key header is provided', () => {
    const guard = new InterServiceAuthGuard(mockConfig() as never);
    const context = mockContext({
      [HEADER_INTERNAL_KEY]: secret,
    });

    expect(guard.canActivate(context as never)).toBe(true);
  });

  it('rejects request when headers are missing', () => {
    const guard = new InterServiceAuthGuard(mockConfig() as never);
    const context = mockContext({});

    expect(() => guard.canActivate(context as never)).toThrow(UnauthorizedException);
  });

  it('rejects request with invalid signature', () => {
    const guard = new InterServiceAuthGuard(mockConfig() as never);
    const context = mockContext({
      [HEADER_SIGNATURE]: 'sha256=invalid-signature',
      [HEADER_TIMESTAMP]: String(now),
    });

    expect(() => guard.canActivate(context as never)).toThrow(UnauthorizedException);
  });

  it('rejects request with expired timestamp', () => {
    const expiredTime = now - 600; // 10 minutes ago
    const signature = computeHmacSignature({
      secret,
      timestamp: expiredTime,
      method: 'POST',
      path: '/api/v1/channels/inbound',
      body: {},
    });

    const guard = new InterServiceAuthGuard(
      mockConfig({ WOOPS_SIGNATURE_EXPIRY_SECONDS: 300 }) as never,
    );
    const context = mockContext({
      [HEADER_SIGNATURE]: signature,
      [HEADER_TIMESTAMP]: String(expiredTime),
    });

    expect(() => guard.canActivate(context as never)).toThrow(UnauthorizedException);
  });
});
