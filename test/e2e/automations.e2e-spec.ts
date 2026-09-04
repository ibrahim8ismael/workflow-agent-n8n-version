import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import * as _supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';
import { AIAdapterService } from '../../src/infrastructure/ai-adapter/ai-adapter.service';
import { RedisService } from '../../src/infrastructure/cache/redis.service';
import { NotificationService } from '../../src/infrastructure/email/notification.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/auth.guard';
import { AuthService } from '../../src/modules/auth/services/auth.service';
import { MockDatabaseService, MockRedisService, mockNotificationService } from '../setup.e2e';

const request = (_supertest as any).default ?? _supertest;

// SSRF guard must not hit real DNS in tests — resolve to a public IP.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

const blueprint = {
  ready: true,
  missingRequirements: [],
  name: 'Invoice sync',
  goal: 'Sync paid invoices into the ledger',
  summary: 'Fetches paid invoices daily and records them.',
  description: 'Daily invoice ledger sync',
  trigger: { type: 'webhook', config: {} },
  steps: [
    { name: 'Fetch invoices', action: 'Fetch paid invoices', integration: 'stripe', config: {} },
  ],
  integrations: ['stripe'],
  inputContract: { type: 'object', required: ['invoiceId'] },
  outputContract: { type: 'object' },
  riskNotes: [],
};

/**
 * RBAC matrix & cross-tenant isolation for client n8n connections and
 * automations (PLAN Step 12).
 */
describe('Automations & n8n Connections (e2e)', () => {
  let app: INestApplication;
  let mockDb: MockDatabaseService;
  let http: ReturnType<typeof request>;

  const userA = { id: 'user-a', activeContext: 'individual' };
  const userB = { id: 'user-b', activeContext: 'individual' };
  let currentUser = userA;

  beforeAll(async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.from(
      '0123456789abcdef0123456789abcdef',
    ).toString('base64');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: string | URL) => {
        const url = typeof input === 'string' ? input : input.href;
        if (url.startsWith('http://localhost:5678/api/v1/workflows')) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ data: [] }),
          };
        }
        return {
          ok: false,
          status: 404,
          headers: { get: () => 'application/json' },
          json: async () => ({}),
        };
      }),
    );

    mockDb = new MockDatabaseService();
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue(mockDb)
      .overrideProvider(RedisService)
      .useValue(new MockRedisService())
      .overrideProvider(NotificationService)
      .useValue(mockNotificationService)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .overrideProvider(AuthService)
      .useValue({} as never)
      .overrideProvider(AIAdapterService)
      .useValue({})
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    await app.close();
  });

  it('user A registers + verifies a client n8n connection', async () => {
    currentUser = userA;
    const res = await http.post('/api/v1/integrations/n8n').send({
      name: 'A n8n',
      baseUrl: 'http://localhost:5678',
      apiKey: 'sk-a-key-123456',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.keyPreview).toBe('…3456');
    expect(JSON.stringify(res.body)).not.toContain('sk-a-key-123456');
  });

  it('user A persists an approved-shape automation draft in PENDING_APPROVAL', async () => {
    currentUser = userA;
    const res = await http.post('/api/v1/automations').send({
      name: 'Invoice sync',
      blueprint,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING_APPROVAL');
    expect(res.body.connectionId).toBeTruthy();
  });

  it('user B cannot read, approve or delete user A resources', async () => {
    currentUser = userA;
    const listRes = await http.get('/api/v1/automations');
    const automationId = listRes.body[0].id;
    const connListRes = await http.get('/api/v1/integrations/n8n');
    console.log('CONN LIST', connListRes.status, JSON.stringify(connListRes.body).slice(0, 400));
    const connectionId = connListRes.body[0]?.id ?? 'missing';

    currentUser = userB;

    const readRes = await http.get(`/api/v1/automations/${automationId}`);
    expect(readRes.status).toBe(404);

    const approveRes = await http.post(`/api/v1/automations/${automationId}/approve`);
    expect(approveRes.status).toBe(404);

    const deleteRes = await http.delete(`/api/v1/automations/${automationId}`);
    expect(deleteRes.status).toBe(404);

    const connReadRes = await http.get(`/api/v1/integrations/n8n/${connectionId}`);
    expect(connReadRes.status).toBe(404);

    const connListB = await http.get('/api/v1/integrations/n8n');
    expect(connListB.status).toBe(200);
    expect(connListB.body).toEqual([]);
  });

  it('user A still sees and can manage their own resources', async () => {
    currentUser = userA;
    const listRes = await http.get('/api/v1/automations');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].name).toBe('Invoice sync');

    const deleteRes = await http.delete(`/api/v1/automations/${listRes.body[0].id}`);
    expect(deleteRes.status).toBe(200);
  });

  it('rejects automation blueprints that violate the schema', async () => {
    currentUser = userA;
    const res = await http.post('/api/v1/automations').send({
      name: 'Broken',
      blueprint: { ...blueprint, steps: [], trigger: { type: 'teleport', config: {} } },
    });
    expect(res.status).toBe(400);
  });
});
