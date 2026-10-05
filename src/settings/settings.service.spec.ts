import type { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  it('keeps the playground closed until an admin explicitly enables it', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = new SettingsService({ systemSetting: { findUnique } } as unknown as PrismaService);

    await expect(service.get()).resolves.toEqual({ playgroundEnabled: false, updatedAt: null });
  });

  it('persists the admin setting with an upsert', async () => {
    const updatedAt = new Date();
    const upsert = jest.fn().mockResolvedValue({ playgroundEnabled: true, updatedAt });
    const service = new SettingsService({ systemSetting: { upsert } } as unknown as PrismaService);

    await expect(service.update(true)).resolves.toEqual({ playgroundEnabled: true, updatedAt });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'global' },
        create: { id: 'global', playgroundEnabled: true },
        update: { playgroundEnabled: true },
      }),
    );
  });
});
