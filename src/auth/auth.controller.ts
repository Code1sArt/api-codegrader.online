import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import type { AuthUser } from '../common/auth-user';
import type { Request } from 'express';
import { AllowWithoutConsent } from '../common/privacy.guard';
import { PRIVACY_POLICY } from '../members/privacy';
import { AcceptPrivacyDto } from '../members/members.dto';
import { AuthService } from './auth.service';
import { GoogleLoginDto } from './dto/google-login.dto';

@ApiTags('Authentication')
@AllowWithoutConsent()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('google')
  loginWithGoogle(@Body() dto: GoogleLoginDto, @Req() request: Request) {
    return this.auth.loginWithGoogle(dto.idToken, request.ip);
  }

  @Public()
  @Get('privacy')
  privacy() { return PRIVACY_POLICY; }

  @ApiBearerAuth()
  @Post('consent')
  acceptPrivacy(@CurrentUser() user: AuthUser, @Body() _dto: AcceptPrivacyDto, @Req() request: Request) { return this.auth.acceptPrivacy(user.sub, request.ip); }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }
}
