#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
mkdir -p "$temp_dir/project/deploy" "$temp_dir/bin"
cp "$repo_dir/deploy/quickstart.sh" "$temp_dir/project/deploy/quickstart.sh"

cat > "$temp_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MOCK_LOG"
case "$1 $2 $3" in
  'image inspect --format') [[ "${MOCK_LOCAL_IMAGE:-1}" == 1 ]] || exit 1; printf '%s\n' "${MOCK_LOCAL_PLATFORM:-linux/amd64}"; exit ;;
  'container inspect --format') printf '%s\n' "${MOCK_BACKUP_MOUNT:-}"; exit ;;
  'container inspect poke-intel') [[ "${MOCK_OLD_CONTAINER:-0}" == 1 ]]; exit ;;
  'info  ') exit 0 ;;
  'pull '*) [[ "${MOCK_PULL_FAIL:-0}" != 1 ]]; exit ;;
  'volume create poke-intel-data') exit 0 ;;
  'run '*) if [[ "${MOCK_RUN_FAIL:-0}" == 1 ]]; then exit 1; fi; printf '%s\n' 'fake-container-id'; exit 0 ;;
esac
exit 0
EOF
cat > "$temp_dir/bin/install" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do last="$arg"; done
mkdir -p "$last"
EOF
cat > "$temp_dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo 'The installer should check health inside the container, without requiring host curl' >&2
exit 1
EOF
cat > "$temp_dir/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$temp_dir/bin/uname" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${MOCK_ARCH:-x86_64}"
EOF
cat > "$temp_dir/bin/openssl" <<'EOF'
#!/usr/bin/env bash
echo 'OpenSSL is intentionally unavailable in this test' >&2
exit 1
EOF
chmod +x "$temp_dir/bin/docker" "$temp_dir/bin/install" "$temp_dir/bin/curl" "$temp_dir/bin/sleep" "$temp_dir/bin/uname" "$temp_dir/bin/openssl"
export PATH="$temp_dir/bin:$PATH" MOCK_LOG="$temp_dir/docker.log" POKE_INTEL_HOME="$temp_dir/project/state"

if MOCK_ARCH='mips64' bash "$temp_dir/project/deploy/quickstart.sh" '8.8.8.8' > "$temp_dir/unsupported.log" 2>&1; then
  echo 'Unsupported CPU architecture was accepted' >&2
  exit 1
fi
[[ ! -e "$MOCK_LOG" ]] || { echo 'Unsupported CPU architecture touched Docker' >&2; exit 1; }

for invalid_ip in 'not-an-ip' '127.0.0.1' '203.0.113.10'; do
  if bash "$temp_dir/project/deploy/quickstart.sh" "$invalid_ip" > "$temp_dir/invalid.log" 2>&1; then
    echo "Invalid IP was accepted: $invalid_ip" >&2
    exit 1
  fi
  [[ ! -e "$MOCK_LOG" ]] || { echo 'Invalid IP touched Docker' >&2; exit 1; }
done

bash "$temp_dir/project/deploy/quickstart.sh" '8.8.8.8' > "$temp_dir/install.log" 2>&1
grep -qx 'ORIGIN=https://8.8.8.8' "$POKE_INTEL_HOME/.env"
grep -qx 'ALLOWED_ORIGINS=https://8.8.8.8' "$POKE_INTEL_HOME/.env"
grep -Eq '^SETTINGS_ENCRYPTION_KEY=[0-9a-f]{64}$' "$POKE_INTEL_HOME/.env"
grep -q '^pull ghcr.io/dll315/poke-intel:latest$' "$MOCK_LOG"
grep -q '^run .*ghcr.io/dll315/poke-intel:latest$' "$MOCK_LOG"
grep -q '^volume create poke-intel-backups$' "$MOCK_LOG"
grep -q 'poke-intel-backups:/app/backups' "$MOCK_LOG"
! grep -q '^build ' "$MOCK_LOG"
! grep -q '^volume rm ' "$MOCK_LOG"

mkdir -p "$temp_dir/pull-failure/deploy"
cp "$repo_dir/deploy/quickstart.sh" "$temp_dir/pull-failure/deploy/quickstart.sh"
export MOCK_LOG="$temp_dir/pull-failure.log" MOCK_LOCAL_IMAGE=0 MOCK_PULL_FAIL=1 POKE_INTEL_HOME="$temp_dir/pull-failure/state"
if bash "$temp_dir/pull-failure/deploy/quickstart.sh" '8.8.8.8' > "$temp_dir/pull-failure-output.log" 2>&1; then
  echo 'Failed image pull was accepted' >&2
  exit 1
fi
[[ ! -e "$POKE_INTEL_HOME/.env" ]] || { echo 'Failed image pull changed configuration' >&2; exit 1; }
! grep -Eq '^(stop|rm) ' "$MOCK_LOG"

export MOCK_LOG="$temp_dir/missing-config.log" MOCK_LOCAL_IMAGE=1 MOCK_PULL_FAIL=0 MOCK_OLD_CONTAINER=1 POKE_INTEL_HOME="$temp_dir/missing-config/state"
if bash "$temp_dir/project/deploy/quickstart.sh" '8.8.8.8' > "$temp_dir/missing-config-output.log" 2>&1; then
  echo 'Existing container without matching configuration was replaced' >&2
  exit 1
fi
! grep -Eq '^(pull|stop|rename|run) ' "$MOCK_LOG"

export MOCK_LOG="$temp_dir/rollback.log" MOCK_LOCAL_IMAGE=1 MOCK_PULL_FAIL=1 MOCK_RUN_FAIL=1 MOCK_OLD_CONTAINER=1 POKE_INTEL_HOME="$temp_dir/rollback-state"
mkdir -p "$POKE_INTEL_HOME"
printf '%s\n' 'SETTINGS_ENCRYPTION_KEY=existing-secret' > "$POKE_INTEL_HOME/.env"
if bash "$temp_dir/project/deploy/quickstart.sh" '8.8.8.8' > "$temp_dir/rollback-output.log" 2>&1; then
  echo 'Failed docker run was accepted' >&2
  exit 1
fi
grep -q '^rename poke-intel poke-intel-previous-' "$MOCK_LOG" || { echo 'Old container was not preserved' >&2; exit 1; }
grep -q '^start poke-intel$' "$MOCK_LOG" || { echo 'Old container was not restarted' >&2; exit 1; }

export MOCK_LOG="$temp_dir/architecture.log" MOCK_LOCAL_IMAGE=1 MOCK_LOCAL_PLATFORM=linux/amd64 MOCK_PULL_FAIL=1 MOCK_RUN_FAIL=0 MOCK_OLD_CONTAINER=1 MOCK_ARCH=aarch64 POKE_INTEL_HOME="$temp_dir/architecture-state"
mkdir -p "$POKE_INTEL_HOME"
printf '%s\n' 'SETTINGS_ENCRYPTION_KEY=existing-secret' > "$POKE_INTEL_HOME/.env"
if bash "$temp_dir/project/deploy/quickstart.sh" '8.8.8.8' > "$temp_dir/architecture-output.log" 2>&1; then
  echo 'Mismatched local image architecture was accepted' >&2
  exit 1
fi
! grep -Eq '^(stop|rename|run) ' "$MOCK_LOG"

unset POKE_INTEL_HOME
mkdir -p "$temp_dir/project/backups"
cat > "$temp_dir/project/.env" <<'EOF'
SETTINGS_ENCRYPTION_KEY=existing-secret
ORIGIN=https://api.example.com
ALLOWED_ORIGINS=https://app.example.com
EOF
export MOCK_LOG="$temp_dir/upgrade.log" MOCK_LOCAL_IMAGE=1 MOCK_LOCAL_PLATFORM=linux/amd64 MOCK_PULL_FAIL=0 MOCK_OLD_CONTAINER=1 MOCK_ARCH=x86_64 MOCK_BACKUP_MOUNT="$temp_dir/old-backups"
bash "$temp_dir/project/deploy/quickstart.sh" '8.8.8.8' > "$temp_dir/upgrade-output.log" 2>&1
grep -qx 'SETTINGS_ENCRYPTION_KEY=existing-secret' "$temp_dir/project/.env"
grep -qx 'ORIGIN=https://api.example.com' "$temp_dir/project/.env"
grep -qx 'ALLOWED_ORIGINS=https://app.example.com,https://api.example.com' "$temp_dir/project/.env"
grep -Fq "$temp_dir/old-backups:/app/backups" "$MOCK_LOG"
! grep -q 'poke-intel-backups:/app/backups' "$MOCK_LOG"

echo 'quickstart smoke checks passed'
