import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { AccessEventKind } from "@prisma/client";
import { isIP } from "node:net";
import { PrismaService } from "../prisma/prisma.service";
import { PRIVACY_POLICY } from "./privacy";

@Injectable()
export class UsageService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(UsageService.name);
  constructor(private readonly prisma: PrismaService) {}
  cutoff() {
    return new Date(Date.now() - PRIVACY_POLICY.retentionDays * 86400000);
  }
  async prune() {
    await this.prisma.userAccessLog.deleteMany({
      where: { createdAt: { lt: this.cutoff() } },
    });
  }
  async onModuleInit() {
    await this.prune();
    this.timer = setInterval(() => {
      void this.prune().catch(() =>
        this.logger.error("Access log cleanup failed"),
      );
    }, 3600000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async consented(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { privacyVersion: true, isActive: true, deletedAt: true },
    });
    return (
      user?.privacyVersion === PRIVACY_POLICY.version &&
      user.isActive &&
      !user.deletedAt
    );
  }
  async record(userId: string, kind: AccessEventKind, address?: string) {
    if (!(await this.consented(userId))) return;
    const ip = address?.replace(/^::ffff:/, "");
    const key =
      kind === AccessEventKind.LOGIN
        ? "loginCount"
        : kind === AccessEventKind.SUBMISSION
          ? "submissionCount"
          : "playgroundCount";
    const graderRunCount = kind === AccessEventKind.PLAYGROUND ? 1 : 0;
    await this.prisma.$transaction([
      this.prisma.userAccessLog.create({
        data: { userId, kind, ip: ip && isIP(ip) ? ip : null },
      }),
      this.prisma.userUsage.upsert({
        where: { userId },
        create: { userId, [key]: 1, graderRunCount },
        update: {
          [key]: { increment: 1 },
          graderRunCount: { increment: graderRunCount },
          lastUsedAt: new Date(),
        },
      }),
    ]);
  }
  async countGraderRun(userId: string) {
    if (!(await this.consented(userId))) return;
    await this.prisma.userUsage.upsert({
      where: { userId },
      create: { userId, graderRunCount: 1 },
      update: { graderRunCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  }
}
