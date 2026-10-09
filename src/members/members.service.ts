import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UsageService } from "./usage.service";
import { MemberQueryDto } from "./members.dto";
const profile = {
  id: true,
  displayName: true,
  email: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  deletedAt: true,
  createdAt: true,
  privacyAcceptedAt: true,
  privacyVersion: true,
  usage: true,
  _count: { select: { submissions: true } },
} as const;
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}
  async list(query: MemberQueryDto) {
    const where: Prisma.UserWhereInput = {
      deletedAt: query.state === "deleted" ? { not: null } : null,
      ...(query.state === "active"
        ? { isActive: true }
        : query.state === "blocked"
          ? { isActive: false }
          : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search } },
              { email: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: profile,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * 50,
        take: 50,
      }),
    ]);
    return { total, items, page: query.page, pageSize: 50 };
  }
  async history(id: string, page: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: profile,
    });
    if (!user) throw new NotFoundException("Member not found");
    const where = { userId: id, createdAt: { gte: this.usage.cutoff() } };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.userAccessLog.count({ where }),
      this.prisma.userAccessLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 50,
        take: 50,
      }),
    ]);
    return { user, total, items, page, pageSize: 50 };
  }
  private async manageable(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt)
      throw new NotFoundException("Member not found");
    if (user.id === actorId || user.role === UserRole.ADMIN)
      throw new BadRequestException(
        "ไม่สามารถบล็อกหรือลบผู้ดูแลระบบจากหน้านี้",
      );
    return user;
  }
  async setStatus(id: string, actorId: string, isActive: boolean) {
    await this.manageable(id, actorId);
    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: profile,
    });
  }
  async remove(id: string, actorId: string) {
    await this.manageable(id, actorId);
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { deleted: true };
  }
}
