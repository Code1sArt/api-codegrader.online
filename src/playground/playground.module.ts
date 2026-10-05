import { Module } from '@nestjs/common';
import { RunnerModule } from '../runner/runner.module';
import { SettingsModule } from '../settings/settings.module';
import { PlaygroundController } from './playground.controller';
import { PlaygroundService } from './playground.service';

@Module({
  imports: [RunnerModule, SettingsModule],
  controllers: [PlaygroundController],
  providers: [PlaygroundService],
})
export class PlaygroundModule {}
