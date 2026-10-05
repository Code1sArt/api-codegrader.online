import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CompetitionsModule } from './competitions/competitions.module';
import { HealthController } from './health.controller';
import { ProblemsModule } from './problems/problems.module';
import { PrismaModule } from './prisma/prisma.module';
import { PlaygroundModule } from './playground/playground.module';
import { RolesGuard } from './common/roles.guard';
import { SettingsModule } from './settings/settings.module';
import { SubmissionsModule } from './submissions/submissions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    ProblemsModule,
    CompetitionsModule,
    SubmissionsModule,
    SettingsModule,
    PlaygroundModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
