import { ConfigService } from '@nestjs/config';
import { Language, SubmissionStatus } from '@prisma/client';
import { PistonRunnerService } from './piston-runner.service';

describe('PistonRunnerService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('converts numeric environment variables before creating the timeout', async () => {
    const values: Record<string, string> = {
      PISTON_BASE_URL: 'http://piston.test',
      PISTON_PYTHON_VERSION: '3.12.0',
      RUNNER_REQUEST_TIMEOUT_MS: '30000',
      RUNNER_MAX_CONCURRENCY: '2',
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
    } as unknown as ConfigService;
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          run: {
            code: 0,
            stdout: '1\n',
            stderr: '',
            memory: 1024,
            cpu_time: 5,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const service = new PistonRunnerService(config);
    await expect(service.execute(Language.PYTHON, 'print(1)', '', 3_000, 128)).resolves.toMatchObject({
      status: SubmissionStatus.ACCEPTED,
      stdout: '1\n',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('http://piston.test/execute');
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
