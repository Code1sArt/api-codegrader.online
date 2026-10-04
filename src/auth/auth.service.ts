import { ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly google: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.google = new OAuth2Client(config.get<string>('GOOGLE_CLIENT_ID'));
  }

  async loginWithGoogle(idToken: string) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId || !/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(clientId)) {
      throw new ServiceUnavailableException('GOOGLE_CLIENT_ID is not configured');
    }

    let payload;
    try {
      const ticket = await this.google.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }
    if (!payload?.sub || !payload.email || !payload.email_verified) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    const email = payload.email.toLowerCase();
    const adminEmails = new Set(
      (this.config.get<string>('ADMIN_EMAILS') ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    const existing = await this.prisma.user.findUnique({ where: { googleSub: payload.sub } });
    const emailOwner = await this.prisma.user.findUnique({ where: { email } });
    if (emailOwner && emailOwner.googleSub !== payload.sub) {
      throw new ConflictException('Email is already linked to a different Google account');
    }
    const role = existing?.role === UserRole.ADMIN || adminEmails.has(email)
      ? UserRole.ADMIN
      : UserRole.USER;
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            email,
            displayName: payload.name ?? existing.displayName,
            avatarUrl: payload.picture ?? existing.avatarUrl,
            role,
          },
        })
      : await this.prisma.user.create({
          data: {
            googleSub: payload.sub,
            email,
            displayName: payload.name ?? email,
            avatarUrl: payload.picture,
            role,
          },
        });
    if (!user.isActive) throw new UnauthorizedException('Account is disabled');
    return this.session(user);
  }

  async me(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { id: true, email: true, displayName: true, avatarUrl: true, role: true },
    });
  }

  private async session(user: { id: string; email: string; displayName: string; avatarUrl: string | null; role: UserRole }) {
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role }),
      user,
    };
  }
}
