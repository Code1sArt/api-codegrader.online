import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/auth-user';
import { RunCodeDto } from './dto/run-code.dto';
import { PlaygroundService } from './playground.service';

@ApiTags('Playground')
@ApiBearerAuth()
@Controller('playground')
export class PlaygroundController {
  constructor(private readonly playground: PlaygroundService) {}

  @Post('run')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  run(@Body() dto: RunCodeDto, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.playground.run(dto, user.sub, request.ip);
  }
}
