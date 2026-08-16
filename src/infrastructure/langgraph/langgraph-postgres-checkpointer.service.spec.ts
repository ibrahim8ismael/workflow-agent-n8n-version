import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { LangGraphPostgresCheckpointerService } from './langgraph-postgres-checkpointer.service';

describe('LangGraphPostgresCheckpointerService', () => {
  it('requires a database URL before creating a saver', () => {
    const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const service = new LangGraphPostgresCheckpointerService(config);

    expect(() => service.getCheckpointer()).toThrow(
      'DATABASE_URL is required for the PostgreSQL LangGraph checkpointer',
    );
  });

  it('creates the saver lazily from the configured database URL', async () => {
    const config = {
      get: vi.fn((key: string) =>
        key === 'database.url' ? 'postgresql://localhost/woops' : undefined,
      ),
    } as unknown as ConfigService;
    const service = new LangGraphPostgresCheckpointerService(config);

    const first = service.getCheckpointer();
    const second = service.getCheckpointer();

    expect(first).toBe(second);
    await service.onModuleDestroy();
  });
});
