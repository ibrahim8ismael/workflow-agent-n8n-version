import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../infrastructure/cache/redis.service';

@Injectable()
export class RuntimeCacheService {
  constructor(private readonly redis: RedisService) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.getValue(`runtime:${key}`);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.setValue(`runtime:${key}`, JSON.stringify(value), ttlSeconds);
    } catch {
      // Cache failures must not fail a runtime request.
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.deleteValue(`runtime:${key}`);
    } catch {
      // Cache failures must not fail a runtime request.
    }
  }
}
