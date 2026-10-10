#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo '用法：bash deploy/quickstart.sh 你的公网IPv4' >&2
  exit 2
fi

public_ip="$1"
if [[ ! "$public_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo '请输入不带 http:// 或 https:// 的公网 IPv4 地址。' >&2
  exit 2
fi
IFS=. read -r -a octets <<< "$public_ip"
for octet in "${octets[@]}"; do
  if (( ${#octet} > 3 || 10#$octet > 255 )) || [[ ${#octet} -gt 1 && "$octet" == 0* ]]; then
    echo 'IPv4 地址格式不正确。' >&2
    exit 2
  fi
done
first=$((10#${octets[0]}))
second=$((10#${octets[1]}))
third=$((10#${octets[2]}))
if (( first == 0 || first == 10 || first == 127 || first >= 224 ||
      (first == 100 && second >= 64 && second <= 127) ||
      (first == 169 && second == 254) ||
      (first == 172 && second >= 16 && second <= 31) ||
      (first == 192 && (second == 168 || (second == 0 && third == 2))) ||
      (first == 198 && second == 51 && third == 100) ||
      (first == 203 && second == 0 && third == 113) )); then
  echo '请填写服务器的真实公网 IPv4，不能使用内网、回环或文档示例地址。' >&2
  exit 2
fi

case "$(uname -m)" in
  x86_64|amd64|aarch64|arm64) ;;
  *) echo '当前 CPU 架构尚无预构建镜像；支持 Linux x86_64 和 ARM64。' >&2; exit 2 ;;
esac

if [[ -n "${POKE_INTEL_HOME:-}" ]]; then
  state_dir="$POKE_INTEL_HOME"
elif [[ -f /opt/poke-intel/.env || $EUID -eq 0 ]]; then
  state_dir='/opt/poke-intel'
else
  state_dir="$HOME/.local/share/poke-intel"
fi
env_file="$state_dir/.env"
backup_dir="$state_dir/backups"
origin="https://$public_ip"

if ! docker info >/dev/null 2>&1; then
  echo 'Docker 服务不可用，请先检查 docker version。' >&2
  exit 1
fi

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

image='ghcr.io/dll315/poke-intel:latest'
echo '正在从 GitHub 下载预构建镜像（最多等待 60 秒）……'
if ! timeout 60s docker pull "$image"; then
  image='poke-intel:local'
  if docker image inspect "$image" >/dev/null 2>&1; then
    echo '下载未成功，改用本机已有镜像。'
  else
    echo '镜像下载失败且本机没有镜像；现有容器未被删除。请检查网络或 GitHub 镜像包是否已设为 Public。' >&2
    exit 1
  fi
fi

mkdir -p "$state_dir"
if [[ ! -f "$env_file" ]]; then
  (umask 077; : > "$env_file")
fi
chmod 600 "$env_file"
set_env ORIGIN "$origin"
set_env ALLOWED_ORIGINS "$origin"
encryption_key="$(sed -n 's/^SETTINGS_ENCRYPTION_KEY=//p' "$env_file" | tail -n 1 | tr -d '\r')"
if [[ -z "$encryption_key" ]]; then
  set_env SETTINGS_ENCRYPTION_KEY "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
fi

docker volume create poke-intel-data >/dev/null
if [[ -d "$backup_dir" ]]; then
  backup_mount="$backup_dir:/app/backups"
else
  docker volume create poke-intel-backups >/dev/null
  backup_mount='poke-intel-backups:/app/backups'
fi
old_container=0
if docker container inspect poke-intel >/dev/null 2>&1; then
  previous_name="poke-intel-previous-$(date +%s)-$$"
  docker stop poke-intel >/dev/null
  if ! docker rename poke-intel "$previous_name" >/dev/null; then
    docker start poke-intel >/dev/null || true
    echo '旧容器改名失败，未继续安装。' >&2
    exit 1
  fi
  old_container=1
fi

restore_previous() {
  if [[ "$old_container" == 1 ]]; then
    docker rm -f poke-intel >/dev/null 2>&1 || true
    docker rename "$previous_name" poke-intel >/dev/null
    docker start poke-intel >/dev/null
    echo '已恢复旧容器，数据库卷未删除。' >&2
  fi
}

if ! docker run -d --name poke-intel --restart unless-stopped \
  --env-file "$env_file" \
  -e NODE_ENV=production -e HOST=0.0.0.0 -e PORT=3001 \
  -e DB_PATH=/app/data/poke.db -e TRUST_PROXY=1 \
  -p 127.0.0.1:3001:3001 \
  -v poke-intel-data:/app/data \
  -v "$backup_mount" \
  "$image" >/dev/null; then
  echo '新容器创建失败。' >&2
  restore_previous
  exit 1
fi

for attempt in {1..45}; do
  if docker exec poke-intel node -e "fetch('http://127.0.0.1:3001/api/v1/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    if [[ "$old_container" == 1 ]]; then docker rm "$previous_name" >/dev/null; fi
    echo '后台已启动。本机接口：http://127.0.0.1:3001/api/v1/status'
    echo '公网网页仍需配置 HTTPS；见 docs/DEPLOYMENT.md。'
    exit 0
  fi
  sleep 1
done

echo '后台未能启动，错误日志如下：' >&2
docker logs --tail 30 poke-intel >&2 || true
restore_previous
exit 1
