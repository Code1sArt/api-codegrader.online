#!/usr/bin/env bash
# Run on the production host as root; keeps the installed image and runtimes.
set -Eeuo pipefail
if [[ ${EUID} -ne 0 ]]; then
  echo 'Run this script with sudo.' >&2
  exit 1
fi
compose_file=/opt/piston/docker-compose.sc-exam.yml
backup_dir="/opt/piston/backups/output-limit-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp -p "$compose_file" "$backup_dir/docker-compose.sc-exam.yml"
rollback() {
  trap - ERR
  cp -p "$backup_dir/docker-compose.sc-exam.yml" "$compose_file"
  docker compose -f "$compose_file" up -d --no-deps --force-recreate api || true
  echo "Piston update failed; restored configuration from $backup_dir" >&2
  exit 1
}
trap rollback ERR
python3 - "$compose_file" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
pattern = r'(?m)^(\s+PISTON_OUTPUT_MAX_SIZE:\s*)["\x27]?\d+["\x27]?\s*$'
updated, count = re.subn(pattern, lambda m: m[1] + '"16777216"', source)
if count != 1:
    raise SystemExit('Expected exactly one PISTON_OUTPUT_MAX_SIZE setting.')
path.write_text(updated)
PY
docker compose -f "$compose_file" config -q
docker compose -f "$compose_file" up -d --no-deps --force-recreate api
python3 - <<'PY'
import json, time, urllib.request
for attempt in range(30):
    try:
        with urllib.request.urlopen('http://127.0.0.1:2000/api/v2/runtimes', timeout=2) as response:
            runtimes = json.load(response)
        if any(runtime['language'] == 'c++' for runtime in runtimes):
            break
    except (OSError, ValueError):
        pass
    time.sleep(1)
else:
    raise SystemExit('Piston did not become ready.')
PY
# Inspect only the relevant setting; never print the complete environment.
docker inspect piston_api --format '{{range .Config.Env}}{{println .}}{{end}}' | python3 -c 'import sys; lines=sys.stdin.read().splitlines(); expected="PISTON_OUTPUT_MAX_SIZE=16777216"; assert expected in lines, "Container output limit does not match"; print(expected)'
trap - ERR
echo "Piston output limit set to 16 MiB; backup: $backup_dir"
