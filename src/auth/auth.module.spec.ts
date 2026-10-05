import { ConfigService } from '@nestjs/config';
import { createJwtOptions } from './auth.module';

describe('createJwtOptions', () => {
  it('treats JWT_EXPIRES_SECONDS as seconds when it comes from env as a string', () => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
      get: jest.fn().mockReturnValue('86400'),
    } as unknown as ConfigService;

    expect(createJwtOptions(config)).toEqual({
      secret: 'test-secret',
      signOptions: { expiresIn: 86_400 },
    });
  });

  it('uses a one-day fallback for an invalid value', () => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
      get: jest.fn().mockReturnValue('invalid'),
    } as unknown as ConfigService;

    expect(createJwtOptions(config).signOptions.expiresIn).toBe(86_400);
  });
});
