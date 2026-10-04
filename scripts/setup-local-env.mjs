import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetPath = resolve(projectDir, '.env');
const referencePath = resolve(projectDir, '..', 'api-SC-Exam', '.env');

if (existsSync(targetPath)) {
  console.log('Keep existing .env (no changes made).');
  process.exit(0);
}
if (!existsSync(referencePath)) {
  console.error('Reference api-SC-Exam/.env was not found. Copy .env.example to .env and configure it manually.');
  process.exit(1);
}

const parse = (content) => new Map(
  content.split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => {
      const index = line.indexOf('=');
      const key = line.slice(0, index);
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [key, value];
    }),
);

const reference = parse(readFileSync(referencePath, 'utf8'));
const referenceDatabaseUrl = reference.get('DATABASE_URL');
if (!referenceDatabaseUrl) throw new Error('DATABASE_URL is missing from api-SC-Exam/.env');

const databaseUrl = new URL(referenceDatabaseUrl);
databaseUrl.pathname = '/labedu_grader';
let output = readFileSync(resolve(projectDir, '.env.example'), 'utf8');
const set = (key, value) => {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  output = output.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}="${escaped}"`);
};

set('DATABASE_URL', databaseUrl.toString());
set('JWT_SECRET', randomBytes(48).toString('base64url'));
for (const key of ['PISTON_BASE_URL', 'PISTON_CPP_VERSION', 'PISTON_PYTHON_VERSION']) {
  const value = reference.get(key);
  if (value) set(key, value);
}

writeFileSync(targetPath, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
console.log('Created grader-api/.env with a new JWT secret and a dedicated labedu_grader database URL.');
