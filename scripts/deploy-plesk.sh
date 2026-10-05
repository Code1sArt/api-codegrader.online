#!/usr/bin/env bash

set -Eeuo pipefail

deploy_path="${1:-}"

if [[ -z "${deploy_path}" || ! -d "${deploy_path}" ]]; then
  echo "Deployment directory does not exist: ${deploy_path}" >&2
  exit 1
fi

cd "${deploy_path}"

if [[ ! -f .env ]]; then
  echo "Missing ${deploy_path}/.env. Create the production environment file before deploying." >&2
  exit 1
fi

# Plesk keeps each supported Node.js release under /opt/plesk/node. SSH
# sessions do not always inherit the version selected in the Node.js panel.
node_major=""
if command -v node >/dev/null 2>&1; then
  node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
fi

if [[ ! "${node_major}" =~ ^(22|23|24)$ ]]; then
  for candidate in /opt/plesk/node/24/bin /opt/plesk/node/23/bin /opt/plesk/node/22/bin; do
    if [[ -x "${candidate}/node" && -x "${candidate}/npm" ]]; then
      export PATH="${candidate}:${PATH}"
      break
    fi
  done
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm were not found. Install Node.js 22 in Plesk Node.js Toolkit." >&2
  exit 1
fi

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ ! "${node_major}" =~ ^(22|23|24)$ ]]; then
  echo "Node.js 22-24 is required; found $(node --version)." >&2
  exit 1
fi

npm ci --no-audit --no-fund
npm run db:generate
npm run build
npm run db:deploy
npm prune --omit=dev --no-audit --no-fund

# Plesk runs Node.js applications through Passenger. Updating this file asks
# Passenger to reload the app on the next request.
mkdir -p tmp
touch tmp/restart.txt

echo "Deployment completed with Node.js $(node --version)."
