import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Strategy } from 'passport-strategy';
import { DatabaseService } from '../../../database/database.service';

class ApiKeyStrategyBase extends Strategy {
  name = 'api-key';
}

@Injectable()
export class ApiKeyStrategy extends ApiKeyStrategyBase {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async authenticate(req: Request) {
    const apiKey = req.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      return this.fail({ message: 'API key is required' }, 401);
    }

    const hashedKey = createHash('sha256').update(apiKey).digest('hex');

    const keyRecord = await this.db.apiKey.findFirst({
      where: { key: hashedKey, status: 'ACTIVE', deletedAt: null },
      include: { user: true, organization: true },
    });

    if (!keyRecord) {
      return this.fail({ message: 'Invalid API key' }, 401);
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      return this.fail({ message: 'API key has expired' }, 401);
    }

    await this.db.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    });

    const context = keyRecord.user
      ? { id: keyRecord.user.id, email: keyRecord.user.email, type: 'user' as const }
      : {
          id: keyRecord.organization!.id,
          name: keyRecord.organization!.name,
          type: 'organization' as const,
        };

    return this.success({
      apiKeyId: keyRecord.id,
      ...context,
    });
  }
}
