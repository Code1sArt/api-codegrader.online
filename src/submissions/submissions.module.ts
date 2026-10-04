import { Module } from '@nestjs/common';
import { RunnerModule } from '../runner/runner.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({ imports: [RunnerModule], controllers: [SubmissionsController], providers: [SubmissionsService] })
export class SubmissionsModule {}
