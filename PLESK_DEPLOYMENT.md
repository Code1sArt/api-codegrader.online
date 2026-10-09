# Deploy to Plesk with GitHub Actions

The workflow in `.github/workflows/ci-cd.yml` runs lint, tests, and a build for
pull requests and pushes. A successful push to `main` is deployed to:

```text
nrgrader.online@118.27.146.122:/var/www/vhosts/nrgrader.online/api.nrgrader.online
```

## 1. Prepare Plesk

In **Websites & Domains > api.nrgrader.online > Node.js**, configure:

- Node.js version: `24`
- Package manager: `npm`
- Document root: `/var/www/vhosts/nrgrader.online/api.nrgrader.online`
- Application root: `/var/www/vhosts/nrgrader.online/api.nrgrader.online`
- Application startup file: `app.js`
- Application mode: `Production`

Do not enable the application until the first deployment has produced
`dist/main.js`.

Create `/var/www/vhosts/nrgrader.online/api.nrgrader.online/.env` on the server.
Use `.env.example` as the list of required keys and set production values. At a
minimum, verify `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `GOOGLE_CLIENT_ID`,
and `PISTON_BASE_URL`. Keep this file on the server; the workflow excludes it
from uploads and deletion.

The database user in `DATABASE_URL` must be allowed to create/alter tables so
that `prisma migrate deploy` can apply committed migrations.

## 2. Create an SSH deployment key

On a trusted computer, create a dedicated key without a passphrase (GitHub
Actions cannot answer an interactive passphrase prompt):

```bash
ssh-keygen -t ed25519 -C "github-actions-api-codegrader" -f ./plesk_deploy_key
```

Add the contents of `plesk_deploy_key.pub` to the Plesk subscription user's
`~/.ssh/authorized_keys`. Confirm that the key can connect and write to the
deployment directory:

```bash
ssh -i ./plesk_deploy_key nrgrader.online@118.27.146.122
```

Record the server host key from a trusted connection. Compare the fingerprint
with the host key shown by the server administrator before accepting it:

```bash
ssh-keyscan -H 118.27.146.122
```

## 3. Add GitHub environment secrets

In the repository, open **Settings > Environments > New environment**, create
an environment named `production`, and add these environment secrets:

- `PLESK_SSH_PRIVATE_KEY`: the complete contents of `plesk_deploy_key`
- `PLESK_SSH_KNOWN_HOSTS`: the verified output from `ssh-keyscan -H 118.27.146.122`

After the first deployment and after enabling Node.js in Plesk, add environment
variable `APP_HEALTH_URL` with value
`https://api.nrgrader.online/api/health`. Future deployments will verify that
the restarted API is healthy. The health-check step is skipped while this
variable is absent, allowing the initial files to be deployed before Node.js is
enabled.

## 4. Run the first deployment

Commit and push these files to `main`. Open the repository's **Actions** tab and
watch **CI/CD to Plesk**. After it succeeds, return to the Plesk Node.js screen,
click **Enable Node.js**, then open:

```text
https://api.nrgrader.online/api/health
https://api.nrgrader.online/api/docs
```

Later pushes to `main` deploy automatically. Pull requests only run CI. The
server deploy script installs exact lockfile dependencies, generates Prisma
Client, builds NestJS, applies database migrations, removes development
dependencies, and requests a Passenger restart.

## Member activity / privacy migration

This release requires migration `20261009100000_members_privacy_activity` before the API restarts and before the frontend is published. The existing deploy script runs Prisma migrations automatically. It adds consent/version timestamps, deletion markers, lifetime usage counters, and access logs; existing members will see the Privacy/Terms popup on their next visit.

The policy text/version and 90-day retention are defined in `src/members/privacy.ts`. Log collection begins after acceptance. IP events cover sign-in, submission and Playground runs; grader-run counters count runner invocations per test or Playground run, including failures. Counters are not inferred from historic submissions. Expired logs are hidden immediately and removed on startup and hourly while the API is running. Application/database backups must have their own retention managed by the operator.

Express trusts only loopback reverse proxies by default. If the Plesk proxy connects from another address, set `TRUST_PROXY` to a comma-separated list of the actual trusted proxy IPs/CIDRs (e.g. `loopback,10.10.0.5/32`). Configure the trusted proxy to replace incoming forwarded headers. Do not trust arbitrary public clients; otherwise IP history can be spoofed. Without a trusted proxy, the recorded address is the direct peer.

Problem and competition deletion preserves grading history. Member deletion permanently removes the account, submissions/source/results, participation, usage counters and IP history. The same Google identity can register a fresh account with no previous scores and must accept Privacy/Terms again. Blocked accounts remain registered and cannot sign in until an admin unblocks them. Shared problems/competitions created by a former admin are transferred to the deleting admin. Admin accounts cannot be deleted/blocked through the member UI.

After updating older installations that used soft member deletion, run `node scripts/purge-deleted-members.cjs`. It permanently removes only members already marked deleted, protects admin accounts, and leaves blocked accounts intact. The cleanup is idempotent.

Verification against an isolated temporary MySQL database:

```bash
npm run test:members:integration
```

The configured database account needs CREATE/DROP DATABASE privileges. The script creates a uniquely named test database, applies all migrations there, checks HTTP consent/role guards, immediate blocking/deletion, counters, retention and score aggregation, and drops only that temporary database on completion. It does not migrate the database named in `DATABASE_URL` or invoke Piston.
