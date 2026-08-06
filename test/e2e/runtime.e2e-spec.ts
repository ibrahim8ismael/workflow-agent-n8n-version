import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import * as _supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';
import { AIAdapterService } from '../../src/infrastructure/ai-adapter/ai-adapter.service';
import { RedisService } from '../../src/infrastructure/cache/redis.service';
import { NotificationService } from '../../src/infrastructure/email/notification.service';
import { AuthService } from '../../src/modules/auth/services/auth.service';
import { MockDatabaseService, MockRedisService, mockNotificationService } from '../setup.e2e';

const request = (_supertest as any).default ?? _supertest;

const fakeAdapter = {
  generateObject: async () => ({
    object: {
      goal: 'Answer the user',
      reasoning: 'The user needs a direct answer.',
      steps: [
        {
          skillId: 'skill-1',
          skillName: 'test-responder',
          order: 1,
          input: { message: 'hello' },
          required: true,
        },
      ],
      missingInputs: [],
      successCriteria: ['User got an answer'],
      estimatedComplexity: 'simple',
      requiresApproval: false,
    },
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  }),
  generateText: async () => ({
    content: 'Hello from the test responder skill!',
    toolCalls: undefined,
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  }),
  generateStream: async function* () {},
};

describe('Runtime (e2e)', () => {
  let app: INestApplication;
  let module: TestingModule;
  let mockDb: MockDatabaseService;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    mockDb = new MockDatabaseService();
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue(mockDb)
      .overrideProvider(RedisService)
      .useValue(new MockRedisService())
      .overrideProvider(NotificationService)
      .useValue(mockNotificationService)
      .overrideProvider(AuthService)
      .useValue({} as never)
      .overrideProvider(AIAdapterService)
      .useValue(fakeAdapter)
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/runs', () => {
    it('should return 400 for empty userMessage', async () => {
      const res = await http
        .post('/api/v1/runs')
        .send({ userMessage: '', agentId: 'agent-1' })
        .expect(400);

      expect(res.body.message).toBeDefined();
    });

    it('should execute a run end-to-end and complete it', async () => {
      const agent = {
        id: 'agent-1',
        name: 'Test Agent',
        slug: 'test-agent',
        model: 'gpt-4o',
        status: 'ACTIVE',
        instructions: 'You are a test agent.',
        config: {},
        deletedAt: null,
      };
      const skill = {
        id: 'skill-1',
        name: 'Test Responder',
        slug: 'test-responder',
        executionMode: 'AI_ONLY',
        status: 'ACTIVE',
        visibility: 'PRIVATE',
        version: 1,
        instructions: 'Reply with a short greeting.',
        deletedAt: null,
      };
      const agentSkill = {
        id: 'agent-skill-1',
        agentId: 'agent-1',
        skillId: 'skill-1',
        name: 'test-responder',
        enabled: true,
        config: {},
        deletedAt: null,
      };
      mockDb.create('agent', { data: agent as never });
      mockDb.create('skill', { data: skill as never });
      mockDb.create('agentSkill', { data: agentSkill as never });

      const res = await http
        .post('/api/v1/runs')
        .send({ userMessage: 'Say hello', agentId: 'agent-1' });
      expect(res.status).toBe(202);

      expect(res.body.runId).toBeDefined();
      expect(res.body.status).toBe('WAITING');
      expect(res.body.response).toContain('approval');

      const approval = await http
        .post(`/api/v1/runs/${res.body.runId}/approve`)
        .send({})
        .expect(202);
      expect(approval.body.status).toBe('COMPLETED');
      expect(approval.body.response).toContain('test responder');

      const runRes = await http.get(`/api/v1/runs/${res.body.runId}`).expect(200);
      expect(runRes.body.status).toBe('COMPLETED');
      expect(runRes.body.result).toContain('test responder');
      expect(runRes.body.promptTokens).toBe(10);
    });

    it('should mark the run FAILED for an unknown agent', async () => {
      const res = await http
        .post('/api/v1/runs')
        .send({ userMessage: 'Hello', agentId: 'does-not-exist' })
        .expect(202);

      expect(res.body.response).toContain('not found');

      const runRes = await http.get(`/api/v1/runs/${res.body.runId}`).expect(200);
      expect(runRes.body.status).toBe('FAILED');
    });
  });

  describe('GET /api/v1/runs/:id', () => {
    it('should return 404 for an unknown run', async () => {
      await http.get('/api/v1/runs/does-not-exist').expect(404);
    });
  });
});
