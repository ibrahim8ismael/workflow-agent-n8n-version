import type { INestApplication } from '@nestjs/common';
import type * as request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapApp,
  closeApp,
  defaultTestAgent,
  generateTestToken,
  getMockDb,
} from '../setup.e2e';

describe('Billing (e2e)', () => {
  let app: INestApplication;
  let http: request.SuperTest<request.Test>;
  let authToken: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    http = defaultTestAgent(app);

    const mockDb = getMockDb();
    mockDb.create('user', {
      data: {
        id: 'test-billing-user',
        email: 'billing@woops.ai',
        name: 'Billing User',
        role: 'USER',
        isActive: true,
        tokenVersion: 1,
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as any,
    });

    authToken = generateTestToken({ sub: 'test-billing-user' });
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('Wallet', () => {
    it('GET /api/v1/wallet should return wallet or create one', async () => {
      const res = await http
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('balanceCredits');
      expect(res.body).toHaveProperty('currency', 'USD');
    });

    it('GET /api/v1/wallet/transactions should return list', async () => {
      const res = await http
        .get('/api/v1/wallet/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Top-Up Packages', () => {
    it('GET /api/v1/top-up/packages should return available packages', async () => {
      const res = await http
        .get('/api/v1/top-up/packages')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Usage', () => {
    it('GET /api/v1/usage should return usage or empty', async () => {
      const res = await http
        .get('/api/v1/usage')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toBeDefined();
    });
  });

  describe('Subscriptions', () => {
    it('GET /api/v1/subscriptions/current should return current or empty', async () => {
      const res = await http
        .get('/api/v1/subscriptions/current')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toBeDefined();
    });
  });

  describe('Coupons', () => {
    it('POST /api/v1/coupons/redeem should fail with invalid coupon', async () => {
      await http
        .post('/api/v1/coupons/redeem')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ code: 'INVALID-COUPON' })
        .expect(400);
    });
  });

  describe('Invoices', () => {
    it('GET /api/v1/invoices should return empty list', async () => {
      const res = await http
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Admin', () => {
    it('GET /api/v1/admin/users should return 401 for non-admin', async () => {
      await http.get('/api/v1/admin/users').set('Authorization', `Bearer ${authToken}`).expect(401);
    });

    it('GET /api/v1/admin/users should return list for admin', async () => {
      const mockDb = getMockDb();
      mockDb.create('user', {
        data: {
          id: 'admin-user',
          email: 'admin@woops.ai',
          name: 'Admin',
          role: 'SYSTEM_ADMINISTRATOR',
          isActive: true,
          tokenVersion: 1,
          emailVerifiedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as any,
      });

      const adminToken = generateTestToken({
        sub: 'admin-user',
        role: 'SYSTEM_ADMINISTRATOR',
      });

      const res = await http
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/v1/admin/analytics/dashboard should return metrics for admin', async () => {
      const adminToken = generateTestToken({
        sub: 'admin-user',
        role: 'SYSTEM_ADMINISTRATOR',
      });

      const res = await http
        .get('/api/v1/admin/analytics/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('mrr');
      expect(res.body).toHaveProperty('arr');
      expect(res.body).toHaveProperty('totalCustomers');
    });
  });
});
