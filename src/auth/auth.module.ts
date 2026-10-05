import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { positiveInteger } from '../common/config-number';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

export function createJwtOptions(config: ConfigService) {
  return {
    secret: config.getOrThrow<string>('JWT_SECRET'),
    signOptions: {
      expiresIn: positiveInteger(config.get<string | number>('JWT_EXPIRES_SECONDS'), 86_400),
    },
  };
}

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: createJwtOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
