import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RunCodeDto } from './dto/run-code.dto';
import { PlaygroundService } from './playground.service';

@ApiTags('Playground')
@ApiBearerAuth()
@Controller('playground')
export class PlaygroundController {
  constructor(private readonly playground: PlaygroundService) {}

  @Post('run')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  run(@Body() dto: RunCodeDto) {
    return this.playground.run(dto);
  }
}
