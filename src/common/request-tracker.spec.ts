import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerStorageService } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { PlaygroundController } from '../playground/playground.controller';
import { requestTracker } from './request-tracker';

describe('classroom rate limits', () => {
  it('allows 40 authenticated students sharing one IP and limits each student independently', async () => {
    const storage = new ThrottlerStorageService();
    const guard = new ThrottlerGuard({ throttlers: [{ ttl: 60_000, limit: 100 }], getTracker: requestTracker }, storage, new Reflector());
    await guard.onModuleInit();
    const handler: unknown = Object.getOwnPropertyDescriptor(PlaygroundController.prototype, 'run')?.value;
    if (typeof handler !== 'function') throw new Error('Missing Playground handler');
    const context = (sub: string) => ({
      getClass: () => PlaygroundController,
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({ ip: '203.0.113.1', headers: {}, user: { sub, email: `${sub}@test.local`, role: UserRole.USER } }),
        getResponse: () => ({ header: jest.fn() }),
      }),
    }) as unknown as ExecutionContext;
    try {
      await expect(Promise.all(Array.from({ length: 40 }, (_, i) => guard.canActivate(context(`student${i}`)))))
        .resolves.toEqual(Array(40).fill(true));
      for (let i = 0; i < 9; i++) await guard.canActivate(context('student0'));
      await expect(guard.canActivate(context('student0'))).rejects.toMatchObject({ status: 429 });
      await expect(guard.canActivate(context('student1'))).resolves.toBe(true);
      expect(requestTracker({ ip: '203.0.113.1' })).toBe('ip:203.0.113.1');
    } finally {
      storage.onApplicationShutdown();
    }
  });
});
