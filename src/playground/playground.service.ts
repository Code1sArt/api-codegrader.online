import { ForbiddenException, Injectable } from '@nestjs/common';
import { PistonRunnerService } from '../runner/piston-runner.service';
import { SettingsService } from '../settings/settings.service';
import { RunCodeDto } from './dto/run-code.dto';

// Keep these at or below the limits configured by the production Piston API.
const PLAYGROUND_TIME_LIMIT_MS = 3_000;
const PLAYGROUND_MEMORY_LIMIT_MB = 128;
const MAX_OUTPUT_LENGTH = 100_000;

@Injectable()
export class PlaygroundService {
  constructor(
    private readonly settings: SettingsService,
    private readonly runner: PistonRunnerService,
  ) {}

  async run(dto: RunCodeDto) {
    if (!(await this.settings.isPlaygroundEnabled())) {
      throw new ForbiddenException('ระบบ Playground ปิดใช้งานอยู่');
    }
    const result = await this.runner.execute(
      dto.language,
      dto.sourceCode,
      dto.stdin,
      PLAYGROUND_TIME_LIMIT_MS,
      PLAYGROUND_MEMORY_LIMIT_MB,
    );
    return {
      ...result,
      stdout: clip(result.stdout),
      stderr: clip(result.stderr),
      compilerOutput: clip(result.compilerOutput),
      message: clip(result.message),
    };
  }
}

function clip(value: string) {
  return value.length <= MAX_OUTPUT_LENGTH
    ? value
    : `${value.slice(0, MAX_OUTPUT_LENGTH)}\n…ผลลัพธ์ถูกตัดที่ 100,000 ตัวอักษร`;
}
