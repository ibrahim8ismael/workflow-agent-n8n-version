import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import 'reflect-metadata';
import _cookieParser from 'cookie-parser';
import * as _supertest from 'supertest';

const request = (_supertest as any).default ?? _supertest;

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/infrastructure/cache/redis.service';
import { NotificationService } from '../src/infrastructure/email/notification.service';
import { AuthController } from '../src/modules/auth/controllers/auth.controller';
import { AuthService } from '../src/modules/auth/services/auth.service';

export class MockDatabaseService {
  private store: Map<string, Map<string, unknown>> = new Map();

  private modelProxy(name: string): this {
    return new Proxy(this, {
      get: (target, prop) => {
        const member = (target as Record<string, unknown>)[prop as string];
        if (typeof member === 'function') {
          return (...args: unknown[]) =>
            (member as (...a: unknown[]) => unknown).call(target, name, ...args);
        }
        return member;
      },
    });
  }

  private collection(name: string): Map<string, unknown> {
    if (!this.store.has(name)) {
      this.store.set(name, new Map());
    }
    return this.store.get(name)!;
  }

  findUnique(
    model: string,
    args: { where: Record<string, unknown>; select?: Record<string, unknown> },
  ) {
    const col = this.collection(model);
    const entry = Array.from(col.values()).find((item: any) => this.matchesWhere(item, args.where));
    return Promise.resolve(entry ?? null);
  }

  findFirst(model: string, args: { where: Record<string, unknown> }) {
    return this.findUnique(model, args);
  }

  findMany(model: string, args: { where?: Record<string, unknown>; orderBy?: unknown } = {}) {
    const col = this.collection(model);
    let results = Array.from(col.values());
    if (args.where) {
      results = results.filter((item: any) => this.matchesWhere(item, args.where!));
    }
    return Promise.resolve(results);
  }

  /**
   * Prisma-ish where matching for the mock store. Scalars keep strict
   * equality; plain objects with comparison keys emulate Prisma scalar
   * filters (needed for TTL filters like `createdAt: { gte }`, which strict
   * equality could never match). Anything else stays strict.
   */
  private matchesWhere(item: any, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, expected]) => {
      if (key === 'OR') {
        return (expected as Array<Record<string, unknown>>).some((condition) =>
          Object.entries(condition).every(([field, value]) => item[field] === value),
        );
      }
      if (this.isOperatorFilter(expected)) {
        return this.matchesOperator(item[key], expected);
      }
      return item[key] === expected;
    });
  }

  private isOperatorFilter(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || value instanceof Date || Array.isArray(value)) {
      return false;
    }
    return ['gte', 'gt', 'lte', 'lt', 'equals', 'in'].some((op) => op in value);
  }

  private matchesOperator(actual: unknown, filter: Record<string, unknown>): boolean {
    if ('equals' in filter && actual !== filter.equals) return false;
    if ('in' in filter && !(filter.in as unknown[]).includes(actual)) return false;
    const comparable = ['gte', 'gt', 'lte', 'lt'].some((op) => op in filter);
    if (comparable) {
      if (actual === undefined || actual === null) return false;
      const left = actual instanceof Date ? actual.getTime() : (actual as number);
      const rightValue = (filter.gte ?? filter.gt ?? filter.lte ?? filter.lt) as unknown;
      const right = rightValue instanceof Date ? rightValue.getTime() : (rightValue as number);
      if ('gte' in filter && !(left >= right)) return false;
      if ('gt' in filter && !(left > right)) return false;
      if ('lte' in filter && !(left <= right)) return false;
      if ('lt' in filter && !(left < right)) return false;
    }
    return true;
  }

  create(
    model: string,
    args: {
      data: Record<string, unknown>;
      select?: Record<string, unknown>;
      include?: Record<string, unknown>;
    },
  ) {
    if (!args?.data) {
      throw new Error(`MockDatabaseService.create(${model}) called without data`);
    }
    const col = this.collection(model);
    const id = args.data.id ?? `mock-${model}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const record = {
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...args.data,
    } as Record<string, unknown>;
    if (args.data.agent && typeof args.data.agent === 'object') {
      const connection = (args.data.agent as { connect?: { id?: string } }).connect;
      if (connection?.id) record.agentId = connection.id;
    }
    if (args.data.conversation && typeof args.data.conversation === 'object') {
      const connection = (args.data.conversation as { connect?: { id?: string } }).connect;
      if (connection?.id) record.conversationId = connection.id;
    }
    // Generic relation flattening (n8n connections & automations, PLAN Step 12)
    const relationFields: Array<[string, string]> = [
      ['user', 'userId'],
      ['organization', 'organizationId'],
      ['connection', 'connectionId'],
    ];
    for (const [key, field] of relationFields) {
      const relation = args.data[key];
      if (relation && typeof relation === 'object' && !Array.isArray(relation)) {
        const connect = (relation as { connect?: { id?: string } }).connect;
        if (connect?.id) record[field] = connect.id;
      }
    }
    col.set(id as string, record);

    if (args.select) {
      const selected: Record<string, unknown> = {};
      for (const key of Object.keys(args.select)) {
        if (key in record) selected[key] = record[key];
      }
      return Promise.resolve(selected);
    }
    if (args.include) {
      return Promise.resolve({ ...record });
    }
    return Promise.resolve(record);
  }

  update(
    model: string,
    args: {
      where: { id: string };
      data: Record<string, unknown>;
      select?: Record<string, unknown>;
    },
  ) {
    const col = this.collection(model);
    const existing = col.get(args.where.id);
    if (!existing) return Promise.resolve(null);
    const updated = { ...(existing as object), ...args.data, updatedAt: new Date() } as Record<
      string,
      unknown
    >;
    col.set(args.where.id, updated);
    if (args.select) {
      const selected: Record<string, unknown> = {};
      for (const key of Object.keys(args.select)) {
        if (key in updated) selected[key] = updated[key];
      }
      return Promise.resolve(selected);
    }
    return Promise.resolve(updated);
  }

  updateMany(
    model: string,
    args: { where: Record<string, unknown>; data: Record<string, unknown> },
  ) {
    const col = this.collection(model);
    let count = 0;
    for (const [id, item] of col.entries()) {
      const record = item as Record<string, unknown>;
      if (Object.entries(args.where).every(([k, v]) => record[k] === v)) {
        Object.assign(record, args.data, { updatedAt: new Date() });
        col.set(id as string, record);
        count++;
      }
    }
    return Promise.resolve({ count });
  }

  upsert(
    model: string,
    args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    },
  ) {
    const col = this.collection(model);
    const existing = Array.from(col.values()).find((item: any) =>
      Object.entries(args.where).every(([k, v]) => item[k] === v),
    );
    if (existing) {
      Object.assign(existing as object, args.update, { updatedAt: new Date() });
      return Promise.resolve(existing);
    }
    const id =
      (args.create.id as string | undefined) ??
      `mock-${model}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const record = {
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...args.create,
    } as Record<string, unknown>;
    for (const [key, value] of Object.entries(args.where)) {
      if (!(key in record)) record[key] = value;
    }
    col.set(id, record);
    return Promise.resolve(record);
  }

  delete(model: string, args: { where: { id: string } }) {
    const col = this.collection(model);
    const existing = col.get(args.where.id);
    if (!existing) return Promise.resolve(null);
    col.delete(args.where.id);
    return Promise.resolve(existing);
  }

  count(model: string, args: { where: Record<string, unknown> } = { where: {} }) {
    const col = this.collection(model);
    let count = col.size;
    if (args.where && Object.keys(args.where).length > 0) {
      count = Array.from(col.values()).filter((item: any) =>
        Object.entries(args.where!).every(([k, v]) => (item as any)[k] === v),
      ).length;
    }
    return Promise.resolve(count);
  }

  aggregate(
    model: string,
    args: { where: Record<string, unknown>; _sum?: Record<string, unknown> },
  ) {
    const col = this.collection(model);
    const items = Array.from(col.values()).filter((item: any) => {
      if (!args.where) return true;
      return Object.entries(args.where).every(([k, v]) => (item as any)[k] === v);
    });
    const result: Record<string, unknown> = { _sum: {} };
    if (args._sum) {
      for (const field of Object.keys(args._sum)) {
        (result._sum as Record<string, unknown>)[field] = items.reduce((acc: number, item: any) => {
          const val = Number(item[field]) || 0;
          return acc + val;
        }, 0);
      }
    }
    return Promise.resolve(result);
  }

  groupBy(model: string, args: { by: string[]; where: Record<string, unknown>; _count: boolean }) {
    const col = this.collection(model);
    const items = Array.from(col.values()).filter((item: any) => {
      if (!args.where) return true;
      return Object.entries(args.where).every(([k, v]) => (item as any)[k] === v);
    });
    const groups: Record<string, { _count: number }> = {};
    for (const item of items) {
      const key = (item as any)[args.by[0]] ?? 'unknown';
      if (!groups[key]) groups[key] = { _count: 0 };
      groups[key]._count++;
    }
    return Promise.resolve(
      Object.entries(groups).map(([key, val]) => ({ [args.by[0]]: key, _count: val._count })),
    );
  }

  // Prisma client-style accessors
  get user() {
    return this.modelProxy('user');
  }
  get session() {
    return this.modelProxy('session');
  }
  get subscription() {
    return this.modelProxy('subscription');
  }
  get subscriptionPlan() {
    return this.modelProxy('subscriptionPlan');
  }
  get wallet() {
    return this.modelProxy('wallet');
  }
  get walletTransaction() {
    return this.modelProxy('walletTransaction');
  }
  get usageMeter() {
    return this.modelProxy('usageMeter');
  }
  get topUpPackage() {
    return this.modelProxy('topUpPackage');
  }
  get topUpPurchase() {
    return this.modelProxy('topUpPurchase');
  }
  get coupon() {
    return this.modelProxy('coupon');
  }
  get couponRedemption() {
    return this.modelProxy('couponRedemption');
  }
  get billingEvent() {
    return this.modelProxy('billingEvent');
  }
  get featureFlag() {
    return this.modelProxy('featureFlag');
  }
  get featureFlagOverride() {
    return this.modelProxy('featureFlagOverride');
  }
  get impersonationLog() {
    return this.modelProxy('impersonationLog');
  }
  get auditLog() {
    return this.modelProxy('auditLog');
  }
  get notification() {
    return this.modelProxy('notification');
  }
  get organization() {
    return this.modelProxy('organization');
  }
  get organizationMember() {
    return this.modelProxy('organizationMember');
  }
  get apiKey() {
    return this.modelProxy('apiKey');
  }
  get invoice() {
    return this.modelProxy('invoice');
  }
  get agent() {
    return this.modelProxy('agent');
  }
  get agentSkill() {
    return this.modelProxy('agentSkill');
  }
  get skill() {
    return this.modelProxy('skill');
  }
  get run() {
    return this.modelProxy('run');
  }
  get agentRunTransition() {
    return this.modelProxy('agentRunTransition');
  }
  get memory() {
    return this.modelProxy('memory');
  }
  get conversation() {
    return this.modelProxy('conversation');
  }
  get conversationMessage() {
    return this.modelProxy('conversationMessage');
  }
  get message() {
    return this.modelProxy('message');
  }
  get knowledgeDocument() {
    return this.modelProxy('knowledgeDocument');
  }
  get knowledgeDocumentChunk() {
    return this.modelProxy('knowledgeDocumentChunk');
  }
  get plan() {
    return this.modelProxy('plan');
  }
  get n8nConnection() {
    return this.modelProxy('n8nConnection');
  }
  get n8nConnectionCredential() {
    return this.modelProxy('n8nConnectionCredential');
  }
  get automation() {
    return this.modelProxy('automation');
  }
}

export class MockRedisService {
  private store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string, mode?: string, ttl?: number): Promise<'OK'> {
    this.store.set(key, value);
    if (mode === 'EX' && ttl) {
      setTimeout(() => this.store.delete(key), ttl * 1000);
    }
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    const existed = this.store.has(key) ? 1 : 0;
    this.store.delete(key);
    return Promise.resolve(existed);
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(this.store.has(key) ? 1 : 0);
  }

  expire(key: string, _ttl: number): Promise<number> {
    return Promise.resolve(this.store.has(key) ? 1 : 0);
  }

  incr(key: string): Promise<number> {
    const raw = this.store.get(key) ?? '0';
    const next = parseInt(raw, 10) + 1;
    this.store.set(key, String(next));
    return Promise.resolve(next);
  }

  setnx(key: string, value: string): Promise<number> {
    if (this.store.has(key)) return Promise.resolve(0);
    this.store.set(key, value);
    return Promise.resolve(1);
  }

  quit(): Promise<'OK'> {
    this.store.clear();
    return Promise.resolve('OK');
  }

  get keyPrefix(): string {
    return 'woops';
  }

  async checkRateLimit(key: string, maxRequests: number, _windowSeconds: number): Promise<boolean> {
    const current = await this.incr(`ratelimit:${key}`);
    return current <= maxRequests;
  }

  async storeOtp(email: string, hashedOtp: string, _ttlSeconds = 300): Promise<void> {
    await this.set(`otp:${email}`, JSON.stringify({ hashedOtp, attempts: 0 }));
  }

  async getOtpData(email: string): Promise<{ hashedOtp: string; attempts: number } | null> {
    const raw = await this.get(`otp:${email}`);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async incrementOtpAttempts(email: string): Promise<number> {
    const data = await this.getOtpData(email);
    if (!data) return 0;
    data.attempts += 1;
    await this.set(`otp:${email}`, JSON.stringify(data));
    return data.attempts;
  }

  async deleteOtp(email: string): Promise<void> {
    await this.del(`otp:${email}`);
  }

  async createSession(
    sessionId: string,
    data: Record<string, unknown>,
    _ttlSeconds: number,
  ): Promise<void> {
    await this.set(`session:${sessionId}`, JSON.stringify(data));
  }

  async getSession(sessionId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.get(`session:${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.del(`session:${sessionId}`);
  }

  async extendSession(_sessionId: string, _ttlSeconds: number): Promise<void> {
    // no-op in mock
  }
}

export const mockNotificationService = {
  sendOtp: (_target: string, _code: string): Promise<void> => Promise.resolve(),
  sendOtpEmail: (_email: string, _code: string): Promise<void> => Promise.resolve(),
  sendOtpSms: (_phone: string, _code: string): Promise<void> => Promise.resolve(),
};

let cachedApp: INestApplication | null = null;
let cachedModule: TestingModule | null = null;

export async function bootstrapApp(): Promise<INestApplication> {
  if (cachedApp) return cachedApp;

  const mockDb = new MockDatabaseService();
  const mockRedis = new MockRedisService();

  // Debug: check param types metadata
  const paramTypes = Reflect.getMetadata('design:paramtypes', AuthController);
  console.log('AuthController param metadata exists:', !!paramTypes);
  if (paramTypes) {
    console.log(
      'AuthController expects:',
      paramTypes[0]?.name,
      'AuthService from import:',
      AuthService.name,
      'same:',
      paramTypes[0] === AuthService,
    );
  }

  cachedModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DatabaseService)
    .useValue(mockDb)
    .overrideProvider(RedisService)
    .useValue(mockRedis)
    .overrideProvider(NotificationService)
    .useValue(mockNotificationService)
    .overrideProvider(AuthService)
    .useValue({
      requestOtp: async (_email: string, _ip: string) => undefined,
      verifyOtp: async (_email: string, otp: string) => {
        if (otp === '000000') {
          throw new UnauthorizedException('Invalid OTP');
        }
        return {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          expiresIn: 900,
        };
      },
      logout: async (_token?: string, _sessionId?: string) => undefined,
      logoutAll: async (_userId: string) => undefined,
    } as any)
    .compile();

  const app = cachedModule.createNestApplication();
  app.use(_cookieParser());
  app.setGlobalPrefix('api/v1');

  await app.init();
  cachedApp = app;
  return app;
}

export async function closeApp(): Promise<void> {
  if (cachedApp) {
    await cachedApp.close();
    cachedApp = null;
    cachedModule = null;
  }
}

export function getMockDb(): MockDatabaseService {
  const module = cachedModule;
  if (!module) throw new Error('App not bootstrapped. Call bootstrapApp() first.');
  return module.get(DatabaseService) as unknown as MockDatabaseService;
}

export function getJwtService(): JwtService {
  const module = cachedModule;
  if (!module) throw new Error('App not bootstrapped. Call bootstrapApp() first.');
  return module.get(JwtService);
}

export function generateTestToken(
  overrides: Partial<{
    sub: string;
    email: string;
    role: string;
    tokenVersion: number;
    sessionId: string;
    activeContext: string;
    organizationId?: string;
  }> = {},
): string {
  const jwt = getJwtService();
  return jwt.sign({
    sub: overrides.sub ?? 'test-user-id',
    email: overrides.email ?? 'test@woops.ai',
    role: overrides.role ?? 'USER',
    tokenVersion: overrides.tokenVersion ?? 1,
    sessionId: overrides.sessionId ?? 'test-session-id',
    activeContext: overrides.activeContext ?? 'individual',
    ...(overrides.organizationId ? { organizationId: overrides.organizationId } : {}),
  });
}

export function setTestUserInDb(
  mockDb: MockDatabaseService,
  overrides: Record<string, unknown> = {},
) {
  const user = {
    id: 'test-user-id',
    email: 'test@woops.ai',
    name: 'Test User',
    phone: null,
    avatarUrl: null,
    role: 'USER',
    isActive: true,
    tokenVersion: 1,
    emailVerifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
  mockDb.create('user', { data: user as any });
  return user;
}

export function defaultTestAgent(app?: INestApplication) {
  if (!app) throw new Error('App not provided');
  return request(app.getHttpServer());
}
