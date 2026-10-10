import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Language, SubmissionStatus } from '@prisma/client';
import { positiveInteger } from '../common/config-number';

type PistonStage = {
  stdout?: string;
  stderr?: string;
  output?: string;
  code?: number | null;
  signal?: string | null;
  status?: string | null;
  message?: string | null;
  memory?: number;
  cpu_time?: number;
  wall_time?: number;
};

type PistonResponse = { compile?: PistonStage; run?: PistonStage; message?: string };

const RUNTIMES: Record<Language, { name: string; file: string; versionKey: string; fallback: string }> = {
  CPP: { name: 'c++', file: 'main.cpp', versionKey: 'PISTON_CPP_VERSION', fallback: '10.2.0' },
  PYTHON: { name: 'python', file: 'main.py', versionKey: 'PISTON_PYTHON_VERSION', fallback: '3.12.0' },
};

@Injectable()
export class PistonRunnerService {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly config: ConfigService) {}

  async execute(language: Language, sourceCode: string, stdin: string, timeLimitMs: number, memoryLimitMb: number, queueTimeoutMs?: number) {
    const release = await this.acquire(queueTimeoutMs);
    try {
      return await this.request(language, sourceCode, stdin, timeLimitMs, memoryLimitMb);
    } finally {
      release();
    }
  }

  private async request(language: Language, sourceCode: string, stdin: string, timeLimitMs: number, memoryLimitMb: number) {
    const baseUrl = this.config.get<string>('PISTON_BASE_URL')?.replace(/\/$/, '');
    if (!baseUrl) throw new ServiceUnavailableException('PISTON_BASE_URL is not configured');
    const runtime = RUNTIMES[language];
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: runtime.name,
          version: this.config.get<string>(runtime.versionKey, runtime.fallback),
          files: [{ name: runtime.file, content: sourceCode, encoding: 'utf8' }],
          stdin,
          compile_timeout: Math.max(10_000, timeLimitMs * 2),
          run_timeout: timeLimitMs,
          compile_memory_limit: 512 * 1024 * 1024,
          run_memory_limit: memoryLimitMb * 1024 * 1024,
        }),
        signal: AbortSignal.timeout(
          positiveInteger(this.config.get<string | number>('RUNNER_REQUEST_TIMEOUT_MS'), 30_000),
        ),
      });
    } catch (error) {
      throw new BadGatewayException(error instanceof Error ? `Cannot connect to Piston: ${error.message}` : 'Cannot connect to Piston');
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException(`Piston returned ${response.status}: ${detail.slice(0, 300)}`);
    }
    const result = (await response.json()) as PistonResponse;
    const compileFailed = Boolean(result.compile && (result.compile.code !== 0 || result.compile.signal || result.compile.status));
    const run = result.run;
    const memoryUsedKb = typeof run?.memory === 'number' ? Math.ceil(run.memory / 1024) : null;
    const executionTimeMs = typeof run?.cpu_time === 'number'
      ? Math.ceil(run.cpu_time)
      : typeof run?.wall_time === 'number' ? Math.ceil(run.wall_time) : null;
    let status: SubmissionStatus = SubmissionStatus.ACCEPTED;
    if (compileFailed) status = SubmissionStatus.COMPILE_ERROR;
    else if (run?.status === 'TO') status = SubmissionStatus.TIME_LIMIT_EXCEEDED;
    else if (run?.status === 'MO' || (memoryUsedKb !== null && memoryUsedKb > memoryLimitMb * 1024)) {
      status = SubmissionStatus.MEMORY_LIMIT_EXCEEDED;
    } else if (run && (run.code !== 0 || run.signal || run.status)) status = SubmissionStatus.RUNTIME_ERROR;
    return {
      status,
      stdout: run?.stdout ?? '',
      stderr: run?.stderr ?? '',
      compilerOutput: compileFailed ? result.compile?.output ?? result.compile?.stderr ?? '' : '',
      message: (compileFailed ? result.compile?.message : run?.message) ?? result.message ?? '',
      executionTimeMs,
      memoryUsedKb,
    };
  }

  private async acquire(queueTimeoutMs?: number) {
    const max = positiveInteger(this.config.get<string | number>('RUNNER_MAX_CONCURRENCY'), 2);
    if (this.active < max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const next = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      const timer = queueTimeoutMs === undefined ? undefined : setTimeout(() => {
        const index = this.waiters.indexOf(next);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new ServiceUnavailableException('คิวรันโค้ดเต็ม กรุณารอสักครู่แล้วลองอีกครั้ง'));
      }, queueTimeoutMs);
      this.waiters.push(next);
    });
    return () => this.release();
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }
}
