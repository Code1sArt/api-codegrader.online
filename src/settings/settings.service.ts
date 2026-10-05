import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const GLOBAL_SETTINGS_ID = 'global';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { id: GLOBAL_SETTINGS_ID },
      select: { playgroundEnabled: true, updatedAt: true },
    });
    return settings ?? { playgroundEnabled: false, updatedAt: null };
  }

  async isPlaygroundEnabled() {
    return (await this.get()).playgroundEnabled;
  }

  update(playgroundEnabled: boolean) {
    return this.prisma.systemSetting.upsert({
      where: { id: GLOBAL_SETTINGS_ID },
      create: { id: GLOBAL_SETTINGS_ID, playgroundEnabled },
      update: { playgroundEnabled },
      select: { playgroundEnabled: true, updatedAt: true },
    });
  }
}
