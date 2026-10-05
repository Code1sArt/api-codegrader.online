import { ForbiddenException } from '@nestjs/common';
import { Language, SubmissionStatus } from '@prisma/client';
import type { PistonRunnerService } from '../runner/piston-runner.service';
import type { SettingsService } from '../settings/settings.service';
import { PlaygroundService } from './playground.service';

describe('PlaygroundService', () => {
  const dto = { language: Language.PYTHON, sourceCode: 'print(input())', stdin: 'hello' };

  it('rejects execution while the admin setting is disabled', async () => {
    const settings = { isPlaygroundEnabled: jest.fn().mockResolvedValue(false) };
    const runner = { execute: jest.fn() };
    const service = new PlaygroundService(
      settings as unknown as SettingsService,
      runner as unknown as PistonRunnerService,
    );

    await expect(service.run(dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(runner.execute).not.toHaveBeenCalled();
  });

  it('runs code with fixed resource limits when enabled', async () => {
    const settings = { isPlaygroundEnabled: jest.fn().mockResolvedValue(true) };
    const result = {
      status: SubmissionStatus.ACCEPTED,
      stdout: 'hello\n',
      stderr: '',
      compilerOutput: '',
      message: '',
      executionTimeMs: 8,
      memoryUsedKb: 1024,
    };
    const runner = { execute: jest.fn().mockResolvedValue(result) };
    const service = new PlaygroundService(
      settings as unknown as SettingsService,
      runner as unknown as PistonRunnerService,
    );

    await expect(service.run(dto)).resolves.toEqual(result);
    expect(runner.execute).toHaveBeenCalledWith(Language.PYTHON, dto.sourceCode, dto.stdin, 5_000, 256);
  });
});
