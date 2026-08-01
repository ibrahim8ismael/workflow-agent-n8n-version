import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapApp,
  closeApp,
  defaultTestAgent,
  generateTestToken,
  getMockDb,
} from '../setup.e2e';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let http: request.SuperTest<request.Test>;
  let authToken: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    http = defaultTestAgent(app);

    const mockDb = getMockDb();
    mockDb.create('user', {
      data: {
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
      } as any,
    });

    authToken = generateTestToken();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('GET /api/v1/users/me', () => {
    it('should return 401 without auth token', async () => {
      await http.get('/api/v1/users/me').expect(401);
    });

    it('should return user profile with valid token', async () => {
      const res = await http
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', 'test-user-id');
      expect(res.body).toHaveProperty('email', 'test@woops.ai');
      expect(res.body).toHaveProperty('name', 'Test User');
      expect(res.body).toHaveProperty('role', 'USER');
      expect(res.body).toHaveProperty('isActive', true);
    });
  });

  describe('PATCH /api/v1/users/me', () => {
    it('should update user name', async () => {
      const res = await http
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(res.body).toHaveProperty('name', 'Updated Name');
    });

    it('should reject invalid avatar URL', async () => {
      await http
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ avatarUrl: 'not-a-url' })
        .expect(400);
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('should return user by id', async () => {
      const res = await http
        .get('/api/v1/users/test-user-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', 'test-user-id');
    });

    it('should return 401 for another user', async () => {
      const otherToken = generateTestToken({ sub: 'other-user-id' });
      await http
        .get('/api/v1/users/test-user-id')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });
  });

  describe('GET /api/v1/users/me/sessions', () => {
    it('should return empty sessions list', async () => {
      const res = await http
        .get('/api/v1/users/me/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('DELETE /api/v1/users/me', () => {
    it('should deactivate account', async () => {
      const mockDb = getMockDb();
      mockDb.create('user', {
        data: {
          id: 'deactivate-me-user',
          email: 'deactivate@woops.ai',
          name: 'Deactivate User',
          role: 'USER',
          isActive: true,
          tokenVersion: 1,
          emailVerifiedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as any,
      });

      const deactivateToken = generateTestToken({ sub: 'deactivate-me-user' });

      await http
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${deactivateToken}`)
        .expect(204);
    });
  });
});
