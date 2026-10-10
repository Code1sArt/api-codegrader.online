import { ConfigService } from '@nestjs/config';
import { Language, SubmissionStatus } from '@prisma/client';
import { PistonRunnerService } from './piston-runner.service';

describe('PistonRunnerService', () => {
  afterEach(() => jest.restoreAllMocks());

  const configFor = (concurrency: number) => ({
    get: (key: string, fallback?: unknown) => ({ PISTON_BASE_URL: 'http://piston.test', RUNNER_MAX_CONCURRENCY: String(concurrency) })[key] ?? fallback,
  }) as unknown as ConfigService;

  it('bounds 40 simultaneous executions and releases slots after runner failures', async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    const fetcher = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      const fail = calls++ === 0;
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => setImmediate(resolve));
      active--;
      if (fail) throw new Error('runner offline');
      return new Response(JSON.stringify({ run: { code: 0, stdout: '1\n' } }));
    });
    const service = new PistonRunnerService(configFor(2));
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => service.execute(Language.PYTHON, 'print(1)', '', 1000, 128)));
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(40);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(39);
  });

  it('removes a timed-out Playground request without leaking a slot or executing it later', async () => {
    let finish!: (response: Response) => void;
    const fetcher = jest.spyOn(global, 'fetch').mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockResolvedValue(new Response(JSON.stringify({ run: { code: 0 } })));
    const service = new PistonRunnerService(configFor(1));
    const first = service.execute(Language.PYTHON, 'print(1)', '', 1000, 128);
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect(service.execute(Language.PYTHON, 'expired', '', 1000, 128, 5)).rejects.toMatchObject({ status: 503 });
    finish(new Response(JSON.stringify({ run: { code: 0 } })));
    await first;
    await service.execute(Language.PYTHON, 'next', '', 1000, 128);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

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
