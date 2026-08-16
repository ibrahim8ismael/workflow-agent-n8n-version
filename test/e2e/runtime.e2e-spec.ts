import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import * as _supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';
import { AIAdapterService } from '../../src/infrastructure/ai-adapter/ai-adapter.service';
import { RedisService } from '../../src/infrastructure/cache/redis.service';
import { NotificationService } from '../../src/infrastructure/email/notification.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/auth.guard';
import { AuthService } from '../../src/modules/auth/services/auth.service';
import { MockDatabaseService, MockRedisService, mockNotificationService } from '../setup.e2e';

const request = (_supertest as any).default ?? _supertest;

const fakeAdapter = {
  generateObject: async ({ systemPrompt }: any) => {
    const isConversation =
      systemPrompt &&
      (systemPrompt.includes('Conversation') || systemPrompt.includes('conversation'));
    if (isConversation) {
      return {
        object: {
          intent: 'conversation',
          goal: 'Respond to the user',
          reasoning: 'The user wants a direct conversation.',
          steps: [],
          missingInputs: [],
          successCriteria: ['User got an answer'],
          estimatedComplexity: 'simple',
          requiresApproval: false,
        },
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    }
    return {
      object: {
        intent: 'task_execution',
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
    };
  },
  generateText: async () => ({
    content: 'Hello from the test responder skill!',
    toolCalls: undefined,
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  }),
  generateStream: async function* () {
    yield { type: 'text', content: 'Hello from stream!' };
    yield {
      type: 'finish',
      finishReason: 'stop',
      usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 },
    };
  },
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
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest().user = {
            id: 'test-user-id',
            activeContext: 'individual',
          };
          return true;
        },
      })
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
        userId: 'test-user-id',
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
        .send({ userMessage: 'Say hello', agentId: 'agent-1', mode: 'execution' });
      expect(res.status).toBe(202);

      expect(res.body.runId).toBeDefined();
      expect(res.body.conversationId).toBeDefined();
      expect(['COMPLETED', 'WAITING']).toContain(res.body.status);

      if (res.body.status === 'WAITING') {
        const approval = await http
          .post(`/api/v1/runs/${res.body.runId}/approve`)
          .send({})
          .expect(202);
        expect(approval.body.status).toBe('COMPLETED');
      }

      const runRes = await http.get(`/api/v1/runs/${res.body.runId}`).expect(200);
      expect(runRes.body.status).toBe('COMPLETED');

      const conversationRes = await http
        .get(`/api/v1/conversations/${res.body.conversationId}`)
        .expect(200);
      expect(conversationRes.body.id).toBe(res.body.conversationId);
    });

    it('should handle an unknown agent gracefully', async () => {
      const res = await http
        .post('/api/v1/runs')
        .send({ userMessage: 'Hello', agentId: 'does-not-exist' })
        .expect(202);

      expect(res.body.runId).toBeDefined();

      const runRes = await http.get(`/api/v1/runs/${res.body.runId}`).expect(200);
      expect(['COMPLETED', 'FAILED', 'WAITING']).toContain(runRes.body.status);
    });

    it('should stream conversation tokens over SSE', async () => {
      mockDb.create('agent', {
        data: {
          id: 'agent-1',
          userId: 'test-user-id',
          name: 'Test Agent',
          slug: 'test-agent',
          model: 'gpt-4o',
          status: 'ACTIVE',
          instructions: 'You are a test agent.',
          config: {},
          deletedAt: null,
        } as never,
      });

      const res = await http
        .post('/api/v1/runs/stream')
        .send({ userMessage: 'Say hello', agentId: 'agent-1', mode: 'conversation' })
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('event: run.started');
      expect(res.text).toContain('event: run.completed');
    });
  });

  describe('GET /api/v1/runs/:id', () => {
    it('should return 404 for an unknown run', async () => {
      await http.get('/api/v1/runs/does-not-exist').expect(404);
    });
  });
});
