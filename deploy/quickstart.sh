#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo '用法：bash deploy/quickstart.sh [公网IPv4]' >&2
  exit 2
fi

public_ip="${1:-}"
if [[ -n "$public_ip" && ! "$public_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo '请输入不带 http:// 或 https:// 的公网 IPv4 地址。' >&2
  exit 2
fi
if [[ -n "$public_ip" ]]; then
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
fi

case "$(uname -m)" in
  x86_64|amd64) host_arch='amd64' ;;
  aarch64|arm64) host_arch='arm64' ;;
  *) echo '当前 CPU 架构尚无预构建镜像；支持 Linux x86_64 和 ARM64。' >&2; exit 2 ;;
esac

if [[ -n "${POKE_INTEL_HOME:-}" ]]; then
  state_dir="$POKE_INTEL_HOME"
elif [[ "${BASH_SOURCE[0]}" == */deploy/quickstart.sh && -f "$(dirname "${BASH_SOURCE[0]}")/../.env" ]]; then
  state_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
elif [[ -f /opt/poke-intel/.env && -f /opt/poke-intel-app/.env ]]; then
  echo '发现两份旧配置，请设置 POKE_INTEL_HOME 为当前容器所用的配置目录后重试。' >&2
  exit 2
elif [[ -f /opt/poke-intel-app/.env ]]; then
  state_dir='/opt/poke-intel-app'
elif [[ -f /opt/poke-intel/.env || $EUID -eq 0 ]]; then
  state_dir='/opt/poke-intel'
else
  state_dir="$HOME/.local/share/poke-intel"
fi
env_file="$state_dir/.env"
backup_dir="$state_dir/backups"
origin='http://localhost:3001'
if [[ -n "$public_ip" ]]; then origin="https://$public_ip"; fi

if ! docker info >/dev/null 2>&1; then
  echo 'Docker 服务不可用，请先检查 docker version。' >&2
  exit 1
fi
if docker container inspect poke-intel >/dev/null 2>&1 && [[ ! -f "$env_file" ]]; then
  echo '已有 poke-intel 容器，但找不到它的配置文件。请设置 POKE_INTEL_HOME 为原 .env 所在目录后重试；旧容器未改动。' >&2
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
  local_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null || true)"
  if [[ "$local_platform" == "linux/$host_arch" ]]; then
    echo '下载未成功，改用本机已有镜像。'
  else
    echo "镜像下载失败，本机也没有适合 linux/$host_arch 的镜像；现有容器未被删除。请检查网络。" >&2
    exit 1
  fi
fi

mkdir -p "$state_dir"
if [[ ! -f "$env_file" ]]; then
  (umask 077; : > "$env_file")
fi
chmod 600 "$env_file"
existing_origin="$(sed -n 's/^ORIGIN=//p' "$env_file" | tail -n 1 | tr -d '\r')"
if [[ -z "$public_ip" && "$existing_origin" =~ ^https://[^/]+$ ]] ||
   [[ -n "$public_ip" && "$existing_origin" =~ ^https://[^/]+$ && ! "$existing_origin" =~ ^https://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && "$existing_origin" != 'https://localhost' ]]; then
  origin="$existing_origin"
fi
set_env ORIGIN "$origin"
allowed_origins="$(sed -n 's/^ALLOWED_ORIGINS=//p' "$env_file" | tail -n 1 | tr -d '\r')"
if [[ ",$allowed_origins," != *",$origin,"* ]]; then
  allowed_origins="${allowed_origins:+$allowed_origins,}$origin"
fi
set_env ALLOWED_ORIGINS "$allowed_origins"
encryption_key="$(sed -n 's/^SETTINGS_ENCRYPTION_KEY=//p' "$env_file" | tail -n 1 | tr -d '\r')"
if [[ -z "$encryption_key" ]]; then
  set_env SETTINGS_ENCRYPTION_KEY "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
fi

docker volume create poke-intel-data >/dev/null
existing_backup_mount=''
if docker container inspect poke-intel >/dev/null 2>&1; then
  existing_backup_mount="$(docker container inspect --format '{{range .Mounts}}{{if eq .Destination "/app/backups"}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' poke-intel)"
fi
if [[ -n "$existing_backup_mount" ]]; then
  backup_mount="$existing_backup_mount:/app/backups"
elif [[ -d "$backup_dir" ]]; then
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
  docker rm -f poke-intel >/dev/null 2>&1 || true
  if [[ "$old_container" == 1 ]]; then
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
