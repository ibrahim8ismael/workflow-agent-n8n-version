import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;

  const redisMock = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    setnx: vi.fn(),
    quit: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(redisMock.set).mockResolvedValue('OK' as never);
    vi.mocked(redisMock.del).mockResolvedValue(1 as never);
    vi.mocked(redisMock.exists).mockResolvedValue(1 as never);
    vi.mocked(redisMock.expire).mockResolvedValue(1 as never);
    service = Object.create(RedisService.prototype) as RedisService;
    (service as unknown as { keyPrefix: string }).keyPrefix = 'woops';
    Object.assign(service, redisMock);
  });

  describe('key helpers', () => {
    it('should read a prefixed value', async () => {
      vi.mocked(redisMock.get).mockResolvedValue('hello' as never);

      const result = await service.getValue('greeting');

      expect(redisMock.get).toHaveBeenCalledWith('woops:greeting');
      expect(result).toBe('hello');
    });

    it('should set a prefixed value with TTL', async () => {
      await service.setValue('greeting', 'hello', 60);

      expect(redisMock.set).toHaveBeenCalledWith('woops:greeting', 'hello', 'EX', 60);
    });

    it('should set a prefixed value without TTL', async () => {
      await service.setValue('greeting', 'hello');

      expect(redisMock.set).toHaveBeenCalledWith('woops:greeting', 'hello');
    });

    it('should delete and check prefixed keys', async () => {
      await service.deleteValue('greeting');
      await service.existsKey('greeting');

      expect(redisMock.del).toHaveBeenCalledWith('woops:greeting');
      expect(redisMock.exists).toHaveBeenCalledWith('woops:greeting');
    });
  });

  describe('OTP', () => {
    it('should store hashed OTP with attempts', async () => {
      await service.storeOtp('a@b.com', 'hashed', 300);

      expect(redisMock.set).toHaveBeenCalledWith(
        'woops:otp:a@b.com',
        JSON.stringify({ hashedOtp: 'hashed', attempts: 0 }),
        'EX',
        300,
      );
    });

    it('should return null when no OTP exists', async () => {
      vi.mocked(redisMock.get).mockResolvedValue(null as never);

      const result = await service.getOtpData('a@b.com');

      expect(result).toBeNull();
    });

    it('should parse stored OTP data', async () => {
      vi.mocked(redisMock.get).mockResolvedValue(
        JSON.stringify({ hashedOtp: 'hashed', attempts: 2 }) as never,
      );

      const result = await service.getOtpData('a@b.com');

      expect(result).toEqual({ hashedOtp: 'hashed', attempts: 2 });
    });

    it('should increment OTP attempts preserving TTL', async () => {
      vi.mocked(redisMock.get).mockResolvedValue(
        JSON.stringify({ hashedOtp: 'hashed', attempts: 2 }) as never,
      );

      const result = await service.incrementOtpAttempts('a@b.com');

      expect(redisMock.set).toHaveBeenCalledWith(
        'woops:otp:a@b.com',
        JSON.stringify({ hashedOtp: 'hashed', attempts: 3 }),
        'KEEPTTL',
      );
      expect(result).toBe(3);
    });

    it('should return 0 when incrementing a missing OTP', async () => {
      vi.mocked(redisMock.get).mockResolvedValue(null as never);

      const result = await service.incrementOtpAttempts('a@b.com');

      expect(result).toBe(0);
    });

    it('should delete OTP data', async () => {
      await service.deleteOtp('a@b.com');

      expect(redisMock.del).toHaveBeenCalledWith('woops:otp:a@b.com');
    });
  });

  describe('sessions', () => {
    it('should create and read a session', async () => {
      await service.createSession('session-1', { userId: 'user-1' }, 3600);
      vi.mocked(redisMock.get).mockResolvedValue(JSON.stringify({ userId: 'user-1' }) as never);

      const result = await service.getSession('session-1');

      expect(redisMock.set).toHaveBeenCalledWith(
        'woops:session:session-1',
        JSON.stringify({ userId: 'user-1' }),
        'EX',
        3600,
      );
      expect(result).toEqual({ userId: 'user-1' });
    });

    it('should destroy and extend a session', async () => {
      await service.destroySession('session-1');
      await service.extendSession('session-1', 600);

      expect(redisMock.del).toHaveBeenCalledWith('woops:session:session-1');
      expect(redisMock.expire).toHaveBeenCalledWith('woops:session:session-1', 600);
    });
  });

  describe('rate limiting', () => {
    it('should allow within the limit', async () => {
      vi.mocked(redisMock.incr).mockResolvedValue(3 as never);

      const result = await service.checkRateLimit('user-1', 5, 60);

      expect(redisMock.incr).toHaveBeenCalledWith('woops:ratelimit:user-1');
      expect(result).toBe(true);
    });

    it('should set expiry on the first request', async () => {
      vi.mocked(redisMock.incr).mockResolvedValue(1 as never);

      await service.checkRateLimit('user-1', 5, 60);

      expect(redisMock.expire).toHaveBeenCalledWith('woops:ratelimit:user-1', 60);
    });

    it('should deny when the limit is exceeded', async () => {
      vi.mocked(redisMock.incr).mockResolvedValue(6 as never);

      const result = await service.checkRateLimit('user-1', 5, 60);

      expect(result).toBe(false);
    });

    it('should report the full quota when nothing is recorded', async () => {
      vi.mocked(redisMock.get).mockResolvedValue(null as never);

      const result = await service.getRemainingRateLimit('user-1', 5);

      expect(result).toBe(5);
    });

    it('should compute remaining requests', async () => {
      vi.mocked(redisMock.get).mockResolvedValue('3' as never);

      const result = await service.getRemainingRateLimit('user-1', 5);

      expect(result).toBe(2);
    });
  });

  describe('distributed locks', () => {
    it('should acquire a lock with TTL', async () => {
      vi.mocked(redisMock.setnx).mockResolvedValue(1 as never);

      const result = await service.acquireLock('job-1');

      expect(redisMock.setnx).toHaveBeenCalledWith('woops:lock:job-1', '1');
      expect(redisMock.expire).toHaveBeenCalledWith('woops:lock:job-1', 10);
      expect(result).toBe(true);
    });

    it('should fail to acquire a held lock', async () => {
      vi.mocked(redisMock.setnx).mockResolvedValue(0 as never);

      const result = await service.acquireLock('job-1');

      expect(redisMock.expire).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should release a lock', async () => {
      await service.releaseLock('job-1');

      expect(redisMock.del).toHaveBeenCalledWith('woops:lock:job-1');
    });
  });

  describe('onModuleDestroy', () => {
    it('should quit the connection', async () => {
      await service.onModuleDestroy();

      expect(redisMock.quit).toHaveBeenCalled();
    });
  });
});
