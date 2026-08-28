import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { verifyHmacSignature } from '../../infrastructure/auth/inter-service-crypto';

export const HEADER_SIGNATURE = 'x-woops-signature';
export const HEADER_TIMESTAMP = 'x-woops-timestamp';
export const HEADER_INTERNAL_KEY = 'x-woops-internal-key';

@Injectable()
export class InterServiceAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secret = this.config.get<string>('WOOPS_INTER_SERVICE_SECRET');

    if (!secret) {
      throw new UnauthorizedException('Inter-service authentication secret is not configured');
    }

    const maxDrift = this.config.get<number>('WOOPS_SIGNATURE_EXPIRY_SECONDS') ?? 300;

    const signature = request.headers[HEADER_SIGNATURE] as string | undefined;
    const timestampStr = request.headers[HEADER_TIMESTAMP] as string | undefined;
    const internalKey = request.headers[HEADER_INTERNAL_KEY] as string | undefined;

    // Optional direct API key match if provided and matches secret or configured internal key
    if (internalKey && internalKey === secret) {
      return true;
    }

    if (!signature || !timestampStr) {
      throw new UnauthorizedException('Missing required inter-service authentication headers');
    }

    const timestamp = Number.parseInt(timestampStr, 10);
    if (Number.isNaN(timestamp)) {
      throw new UnauthorizedException('Invalid timestamp in inter-service authentication headers');
    }

    const rawSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;

    const verification = verifyHmacSignature({
      secret,
      signature: rawSignature,
      timestamp,
      method: request.method,
      path: request.originalUrl || request.url,
      body: request.body ?? {},
      maxDriftSeconds: maxDrift,
    });

    if (!verification.valid) {
      if (verification.reason === 'TIMESTAMP_EXPIRED') {
        throw new UnauthorizedException('Inter-service request timestamp has expired');
      }
      throw new UnauthorizedException('Inter-service signature verification failed');
    }

    return true;
  }
}
