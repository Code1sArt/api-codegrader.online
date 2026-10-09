#!/usr/bin/env bash
# Run on the production host as root; preserves the installed image and runtimes.
set -Eeuo pipefail
if [[ ${EUID} -ne 0 ]]; then
  echo 'Run this script with sudo.' >&2
  exit 1
fi
compose_file=/opt/piston/docker-compose.sc-exam.yml
patch_file=/opt/piston/api/src/index.nrgrader-input-limit.js
backup_dir="/opt/piston/backups/input-limit-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp -p "$compose_file" "$backup_dir/docker-compose.sc-exam.yml"
docker cp piston_api:/piston_api/src/index.js "$backup_dir/index.js"
docker cp piston_api:/piston_api/src/job.js "$backup_dir/job.js"
python3 - "$backup_dir/index.js" "$patch_file" "$compose_file" "$backup_dir/job.js" <<'PY'
import pathlib, sys
original, patched, compose, original_job = map(pathlib.Path, sys.argv[1:])
source = original.read_text()
old = 'app.use(body_parser.json());'
new = "app.use(body_parser.json({ limit: '64mb' }));"
if old not in source and new not in source:
    raise SystemExit('Unexpected Piston JSON middleware; no changes made.')
job = original_job.read_text()
old_stdin = '            proc.stdin.write(this.stdin);\n            proc.stdin.end();\n            proc.stdin.destroy();'
new_stdin = """            proc.stdin.on('error', err => {
                if (err.code !== 'EPIPE') this.logger.error(err.message);
            });
            proc.stdin.end(this.stdin);"""
if old_stdin not in job and new_stdin not in job:
    raise SystemExit('Unexpected Piston stdin implementation; no changes made.')
patched_job = patched.with_name('job.nrgrader-input-limit.js')
contents = compose.read_text()
mount = '      - /opt/piston/api/src/index.nrgrader-input-limit.js:/piston_api/src/index.js:ro'
if mount not in contents:
    anchor = '      - /opt/piston/data/piston/packages:/piston/packages'
    if anchor not in contents:
        raise SystemExit('Unexpected compose volumes; no changes made.')
    contents = contents.replace(anchor, anchor + '\n' + mount, 1)
job_mount = '      - /opt/piston/api/src/job.nrgrader-input-limit.js:/piston_api/src/job.js:ro'
if job_mount not in contents:
    contents = contents.replace(mount, mount + '\n' + job_mount, 1)
patched_job.write_text(job.replace(old_stdin, new_stdin, 1))
patched_job.chmod(0o644)
patched.write_text(source.replace(old, new, 1))
patched.chmod(0o644)
compose.write_text(contents)
PY
if ! docker compose -f "$compose_file" config -q; then
  cp -p "$backup_dir/docker-compose.sc-exam.yml" "$compose_file"
  echo "Invalid compose configuration; restored backup at $backup_dir" >&2
  exit 1
fi
docker compose -f "$compose_file" up -d --force-recreate api
echo "Piston JSON limit set to 64 MB and stdin flushing fixed; backup: $backup_dir"
