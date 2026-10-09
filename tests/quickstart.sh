#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
mkdir -p "$temp_dir/project/deploy" "$temp_dir/bin"
cp "$repo_dir/.env.example" "$temp_dir/project/.env.example"
cp "$repo_dir/deploy/quickstart.sh" "$temp_dir/project/deploy/quickstart.sh"

cat > "$temp_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MOCK_LOG"
case "$1 $2 $3" in
  'image inspect poke-intel:local') [[ "${MOCK_LOCAL_IMAGE:-1}" == 1 ]]; exit ;;
  'container inspect poke-intel') exit 0 ;;
  'info  ') exit 0 ;;
  'pull '*) [[ "${MOCK_PULL_FAIL:-0}" != 1 ]]; exit ;;
  'volume create poke-intel-data') exit 0 ;;
  'run '*) printf '%s\n' 'fake-container-id'; exit 0 ;;
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
chmod +x "$temp_dir/bin/docker" "$temp_dir/bin/install" "$temp_dir/bin/curl" "$temp_dir/bin/sleep"
export PATH="$temp_dir/bin:$PATH" MOCK_LOG="$temp_dir/docker.log"

for invalid_ip in 'not-an-ip' '127.0.0.1' '203.0.113.10'; do
  if bash "$temp_dir/project/deploy/quickstart.sh" "$invalid_ip" > "$temp_dir/invalid.log" 2>&1; then
    echo "Invalid IP was accepted: $invalid_ip" >&2
    exit 1
  fi
  [[ ! -e "$MOCK_LOG" ]] || { echo 'Invalid IP touched Docker' >&2; exit 1; }
done

bash "$temp_dir/project/deploy/quickstart.sh" '8.8.8.8' > "$temp_dir/install.log" 2>&1
grep -qx 'ORIGIN=https://8.8.8.8' "$temp_dir/project/.env"
grep -qx 'ALLOWED_ORIGINS=https://8.8.8.8' "$temp_dir/project/.env"
grep -Eq '^SETTINGS_ENCRYPTION_KEY=[0-9a-f]{64}$' "$temp_dir/project/.env"
grep -q '^pull ghcr.io/dll315/poke-intel:latest$' "$MOCK_LOG"
grep -q '^run .*ghcr.io/dll315/poke-intel:latest$' "$MOCK_LOG"
! grep -q '^build ' "$MOCK_LOG"
! grep -q '^volume rm ' "$MOCK_LOG"

mkdir -p "$temp_dir/pull-failure/deploy"
cp "$repo_dir/.env.example" "$temp_dir/pull-failure/.env.example"
cp "$repo_dir/deploy/quickstart.sh" "$temp_dir/pull-failure/deploy/quickstart.sh"
export MOCK_LOG="$temp_dir/pull-failure.log" MOCK_LOCAL_IMAGE=0 MOCK_PULL_FAIL=1
if bash "$temp_dir/pull-failure/deploy/quickstart.sh" '8.8.8.8' > "$temp_dir/pull-failure-output.log" 2>&1; then
  echo 'Failed image pull was accepted' >&2
  exit 1
fi
[[ ! -e "$temp_dir/pull-failure/.env" ]] || { echo 'Failed image pull changed configuration' >&2; exit 1; }
! grep -Eq '^(stop|rm) ' "$MOCK_LOG"

echo 'quickstart smoke checks passed'
