import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapApp, closeApp, defaultTestAgent, getJwtService, getMockDb } from '../setup.e2e';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let http: request.SuperTest<request.Test>;

  beforeAll(async () => {
    app = await bootstrapApp();
    http = defaultTestAgent(app);
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('POST /api/v1/auth/otp/request', () => {
    it('should accept OTP request for valid email', async () => {
      const res = await http.post('/api/v1/auth/otp/request').send({ email: 'test@woops.ai' });
      if (res.status !== 200) console.log('Response body:', JSON.stringify(res.body));
      expect(res.status).toBe(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('OTP sent to email');
    });

    it('should reject invalid email format', async () => {
      const res = await http
        .post('/api/v1/auth/otp/request')
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(res.body.message).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/otp/verify', () => {
    it('should fail with invalid OTP', async () => {
      const res = await http
        .post('/api/v1/auth/otp/verify')
        .send({ email: 'test@woops.ai', otp: '000000' })
        .expect(401);

      expect(res.body.message).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should return 401 without refresh cookie', async () => {
      await http.post('/api/v1/auth/refresh').expect(401);
    });
  });

  describe('POST /api/v1/auth/switch-organization', () => {
    it('should return 401 without auth token', async () => {
      await http
        .post('/api/v1/auth/switch-organization')
        .send({ organizationId: 'org-1' })
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should return 204 with valid auth token', async () => {
      const mockDb = getMockDb();
      const user = {
        id: 'logout-test-user',
        email: 'logout@woops.ai',
        name: 'Logout User',
        role: 'USER',
        isActive: true,
        tokenVersion: 1,
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockDb.create('user', { data: user as any });

      const jwt = getJwtService();
      const token = jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: 1,
        sessionId: 'logout-session',
        activeContext: 'individual',
      });

      await http.post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
    });
  });

  describe('POST /api/v1/auth/logout-all', () => {
    it('should return 204 with valid auth token', async () => {
      const mockDb = getMockDb();
      const user = {
        id: 'logout-all-test-user',
        email: 'logout-all@woops.ai',
        name: 'Logout All User',
        role: 'USER',
        isActive: true,
        tokenVersion: 1,
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockDb.create('user', { data: user as any });

      const jwt = getJwtService();
      const token = jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: 1,
        sessionId: 'logout-all-session',
        activeContext: 'individual',
      });

      await http
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    });
  });
});
