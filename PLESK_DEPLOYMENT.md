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
