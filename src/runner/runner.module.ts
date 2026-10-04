import { Module } from '@nestjs/common';
import { PistonRunnerService } from './piston-runner.service';

@Module({ providers: [PistonRunnerService], exports: [PistonRunnerService] })
export class RunnerModule {}
