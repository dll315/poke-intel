# 部署指南

本项目有网页和 Node.js 后台两部分。后台负责账号、SQLite 数据库、Alphapedia 定时检查和企业微信推送，必须保持运行。推荐在 Ubuntu 服务器上用 Docker Compose 或 `docker run` 部署完整网站；GitHub Pages 只能托管前端文件，仍需另行部署后台。

**系统提示：**下文的 Docker 镜像和 `docker run` 命令也适用于 OpenCloudOS，但 `apt`、snap 安装及 `/etc/nginx/sites-available` 等主机操作示例按 Ubuntu 编写。若终端提示符出现 `opencloudos`，主机软件使用 `dnf` 管理，请先确认系统版本，不要直接照搬 Ubuntu 的 Nginx/Certbot 安装段落。详见 [OpenCloudOS 官方软件包管理说明](https://docs.opencloudos.org/en/OCS/AdministratorGuide/Software_Management/)。

## 快速启动已有源码

源码已在 `/opt/poke-intel` 且 Docker 可用时，用一行命令启动后台；把示例 IP 换成实际公网 IPv4：

```bash
git -C /opt/poke-intel pull --ff-only && bash /opt/poke-intel/deploy/quickstart.sh 你的公网IP
```

全新服务器已安装 Docker 时，先用 `git clone https://github.com/dll315/poke-intel.git /opt/poke-intel` 获取源码，再运行同一条脚本命令。脚本自动创建或修正 `.env` 的 `ORIGIN`、`ALLOWED_ORIGINS`，只在密钥缺失时生成新密钥；保留 `poke-intel-data` 数据卷和其他已有设置。它优先拉取[已公开的预构建镜像](https://github.com/users/dll315/packages/container/package/poke-intel)，下载失败时使用本机已有的 `poke-intel:local` 镜像；两者都不可用时不删除旧容器。

脚本只将 3001 绑定到服务器本机，并通过健康接口确认后台已启动。**这不等于公网网页已经可用**：账号登录需要真正的 HTTPS，请继续按下文配置证书与反向代理；OpenCloudOS 的系统安装步骤不能照搬 Ubuntu 命令。首次启动后执行 `docker exec -it poke-intel node scripts/admin.mjs admin 管理员` 创建管理员。

## 发布前准备

1. 准备一个指向服务器公网 IP 的域名，例如 `intel.example.com`；**没有域名也可以使用公网 IP 证书**，按下文“无域名：公网 IP + HTTPS”操作。安全组开放 80、443 和现有 SSH 端口；不要开放 3001。在中国大陆提供公网网站时，请按接入商要求处理相关备案或接入手续。
2. 在服务器安装 [Docker Engine 与 Compose 插件](https://docs.docker.com/engine/install/ubuntu/)。4 核 4 GB 的单机可先用此方案；数据库使用一个持久卷，**不要启动多个共享该库的后台副本**。Docker 安装后先执行 `docker version`；若当前账号没有访问 Docker 的权限，可在本指南的 Docker 命令前加 `sudo`，或按 [Docker 官方说明](https://docs.docker.com/engine/install/linux-postinstall/)配置权限。
3. 从 GitHub 克隆仓库，进入项目目录。以下命令假定目录为 `/opt/poke-intel`：

   ```bash
   sudo mkdir -p /opt/poke-intel
   sudo chown "$USER":"$USER" /opt/poke-intel
   git clone https://github.com/dll315/poke-intel.git /opt/poke-intel
   cd /opt/poke-intel
   cp .env.example .env
   ```

   如果 `ls -l /opt/poke-intel/Dockerfile` 已能看到文件，就跳过 `mkdir`、`chown` 和 `git clone`，直接进入源码目录；已有 `.env` 时也不要覆盖。**单独运行** `nano .env`，保存退出后再单独运行 `chmod 600 .env`。不要将编辑器和后续命令整段粘贴，以免把命令写入 `.env`。

4. 将 `.env` 中的 `ORIGIN` 设为 `https://intel.example.com`，无域名时设为 `https://你的公网IP`；`ALLOWED_ORIGINS` 至少填相同地址，不要保留示例中的 `localhost`。设置 `NODE_ENV=production`、`HOST=0.0.0.0`、`PORT=3001`、`TRUST_PROXY=1`。如果使用 Pages 自定义域名，再把 Pages 域名以逗号加入 `ALLOWED_ORIGINS`。`SETTINGS_ENCRYPTION_KEY` 可用 `openssl rand -hex 32` 生成并妥善保存。只有确认可以复用 Alphapedia 数据时，才把 `ALPHAPEDIA_ENABLED`、`ALPHAPEDIA_PERMISSION_CONFIRMED`、`ALPHA_MONITOR_ENABLED`、`SWARM_MONITOR_ENABLED`、`PHENO_MONITOR_ENABLED` 设为 `1`。机器人链接可在管理员页面填写，不要提交到 Git。

`ORIGIN` 是后台网站地址，必须是 HTTPS 的完整来源（协议和域名，可含端口，不带路径或末尾斜杠）。`DB_PATH` 对 Docker 容器应为 `/app/data/poke.db`。`.env`、数据库和备份目录已被 Git 忽略。

## 方式一：Docker Compose（推荐）

在项目目录运行：

```bash
sudo install -d -o 1000 -g 1000 -m 700 /opt/poke-intel/backups
docker compose up -d --build
docker compose ps
docker compose logs --tail 100 app
docker compose exec app node scripts/admin.mjs admin 管理员
```

最后一条命令在终端交互输入管理员密码；普通用户可在网页自行注册。Compose 只把 3001 映射到服务器的 `127.0.0.1`，数据库存入 `poke-data` 命名卷，备份写到 `./backups`。不要执行 `docker compose down -v`，否则会删除数据库卷。

更新前先备份，再执行：

```bash
cd /opt/poke-intel
docker compose exec -T app node scripts/backup.mjs
git pull --ff-only
docker compose up -d --build
docker compose ps
```

如果 GitHub 默认分支不是当前检出的分支，先检查 `git branch -vv`，再按实际分支更新。构建需要从 Docker Hub 和 npm 下载依赖；大陆网络若无法连接，应在可联网环境构建镜像后传到服务器。

## 方式二：单容器 `docker run`

此方式与 Compose 二选一；**不要让两个容器同时使用同一个数据库卷或占用同一个端口**。在项目目录运行：

```bash
cd /opt/poke-intel
ls -l Dockerfile package-lock.json .env
docker build -t poke-intel:local .
```

**只有上一段构建成功，才能执行下一段。** 如果报错 `EOF`，镜像尚未生成；先按下方[构建中断或 EOF](#构建中断或-eof)排查，不要运行 `docker run`。

```bash
docker volume create poke-intel-data
sudo install -d -o 1000 -g 1000 -m 700 /opt/poke-intel/backups
docker run -d --name poke-intel --restart unless-stopped \
  --env-file .env \
  -e NODE_ENV=production -e HOST=0.0.0.0 -e PORT=3001 \
  -e DB_PATH=/app/data/poke.db -e TRUST_PROXY=1 \
  -p 127.0.0.1:3001:3001 \
  -v poke-intel-data:/app/data \
  -v /opt/poke-intel/backups:/app/backups \
  poke-intel:local
```

容器启动后，先确认服务可用，再单独运行交互式管理员命令：

```bash
docker ps --filter name=poke-intel
docker logs --tail 100 poke-intel
curl -f http://127.0.0.1:3001/api/v1/status
```

```bash
docker exec -it poke-intel node scripts/admin.mjs admin 管理员
```

`ls` 必须同时列出这三个文件，才能继续构建；否则先按下方恢复步骤找准源码目录。如果已有真实备案号，可在构建命令中加入 `--build-arg VITE_ICP_NUMBER=你的实际备案号`；没有就保持上面的原命令，勿填占位文字。`ORIGIN`、`ALLOWED_ORIGINS`、监控和机器人配置由 `.env` 提供，**请先编辑 `.env` 再启动**。检查状态：`curl -f http://127.0.0.1:3001/api/v1/status`，若 `curl` 未安装，Ubuntu 执行 `sudo apt install curl`，OpenCloudOS 执行 `sudo dnf install curl`。

### 构建中断或 EOF

如果 `docker build` 报 `failed to receive status ... EOF`，这是构建连接中断的信息，单靠这一行不能判断是 Docker 服务、磁盘、内存还是下载环节。不要反复执行 `docker run`，也不要删除 `poke-intel-data` 数据卷。先检查：

```bash
docker version
free -h
df -h / /var/lib/docker
journalctl -u docker.service -b -n 60 --no-pager
journalctl -k -b --no-pager | grep -Ei 'out of memory|oom|killed process' | tail -n 20
```

如果 `docker version` 能显示 Server 信息，再从源码目录运行 `docker build --progress=plain -t poke-intel:local .`，根据最后失败的步骤处理；若 Server 不可用，先查看 Docker 服务日志。只有构建成功且 `docker image inspect poke-intel:local` 能找到镜像，才运行容器。不要把 `.env`、机器人链接或密钥贴到公开日志中。

### 找不到 Dockerfile 时

`docker build ... .` 最后的 `.` 表示“使用当前目录”。若终端仍显示 `~`，Docker 会在用户主目录找 `Dockerfile`，即使镜像仓库已在 GitHub 也不会自动下载源码。先检查是否已经把仓库克隆到 `/opt/poke-intel`：

```bash
ls -la /opt/poke-intel
```

如果能看到 `Dockerfile`，执行 `cd /opt/poke-intel`，然后继续构建。如果该目录只有先前创建的 `backups/`，**不要删除备份目录或数据卷**；Git 不能克隆进这个非空目录，可把源码克隆到另一处：

```bash
git clone https://github.com/dll315/poke-intel.git /opt/poke-intel-app
cd /opt/poke-intel-app
cp .env.example .env
ls -l Dockerfile package-lock.json .env
```

编辑这个新目录里的 `.env` 后，从 `docker build -t poke-intel:local .` 继续。原 `docker run` 命令的备份挂载 `/opt/poke-intel/backups:/app/backups` 可以保持不变；命名卷 `poke-intel-data` 若已创建也无需再次创建。如果 `/opt/poke-intel-app` 已存在，先检查其内容，不要覆盖。`docker build` 失败时镜像尚未生成，先不要执行 `docker run`。后续更新也应进入实际存放 `Dockerfile` 的源码目录；采用上面恢复步骤的服务器应使用 `/opt/poke-intel-app`。

更新时先备份，再替换容器；数据库仍在命名卷中：

```bash
cd /opt/poke-intel  # 如果源码克隆到了 /opt/poke-intel-app，改为该目录
docker exec poke-intel node scripts/backup.mjs
git pull --ff-only
docker build -t poke-intel:local .
docker stop poke-intel
docker rm poke-intel
```

然后重复上面的**同一条** `docker run` 命令，并检查 `docker logs --tail 100 poke-intel` 和健康接口。不要执行 `docker volume rm poke-intel-data` 或 `docker rm -v poke-intel`。如需修改 `.env`，重新创建容器才会生效；单纯 `docker restart` 不会重新读取环境文件。

## 给两种 Docker 部署配置 HTTPS

在 Ubuntu 上安装并启动 Nginx、Certbot：

```bash
sudo apt update
sudo apt install nginx certbot
sudo systemctl enable --now nginx
```

将 [HTTP 模板](../deploy/nginx.conf) 复制到 `/etc/nginx/sites-available/poke-intel`，把所有 `intel.example.com` 改成自己的域名，然后：

```bash
sudo mkdir -p /var/www/certbot
sudo ln -s /etc/nginx/sites-available/poke-intel /etc/nginx/sites-enabled/poke-intel
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d intel.example.com
```

证书签发成功后，用 [HTTPS 模板](../deploy/nginx-https.conf) 覆盖站点配置，替换所有域名及证书路径，再执行 `sudo nginx -t && sudo systemctl reload nginx`。如主机已有该软链接，不要重复创建。可用 `sudo certbot renew --dry-run` 测试续期，并配置证书续期后重载 Nginx。后台的 `TRUST_PROXY=1` 只适用于这个回环地址上的反向代理；模板会覆盖访客传入的转发 IP 头。

首次访问 `https://intel.example.com` 后，确认注册、登录、管理员审核、公开情报及机器人测试。若提示“请求来源校验失败”，核对浏览器实际访问的来源与 `.env` 中 `ORIGIN` / `ALLOWED_ORIGINS`，修改后重建或重启容器。

## 无域名：公网 IP + HTTPS

如果没有域名，2026 年起可以用 [Let's Encrypt 公网 IP 证书](https://letsencrypt.org/2026/03/11/shorter-certs-certbot.html)。证书有效期约六天，**必须确认自动续期可用**。需要固定、可从互联网访问的公网 IPv4，安全组开放 80/443；Certbot 须为 **5.4 或更高版本**。GitHub Pages 与 IP 后台属于不同站点，因此 Pages 登录仍不可用；直接打开 `https://公网IP` 使用完整网站。

先按“发布前准备”编辑 `.env`，把 `ORIGIN` 和 `ALLOWED_ORIGINS` 均设为 `https://实际公网IP`，按 Compose 或 `docker run` 方式启动容器。3001 仍只绑定服务器回环地址。然后在服务器安装 Nginx、snapd 与新版 Certbot（如果已安装 Certbot snap，跳过 `snap install`）：

```bash
sudo apt update
sudo apt install nginx snapd curl
sudo systemctl enable --now nginx
sudo snap install --classic certbot
sudo /snap/bin/certbot --version
```

确认版本至少为 5.4 后，在同一个终端输入公网 IPv4。使用单独的 Nginx 站点文件，不覆盖其他网站；如果已存在同名文件，先改用其他文件名并相应调整下面的命令：

```bash
read -rp '请输入服务器公网 IPv4：' SERVER_IP
sudo mkdir -p /var/www/certbot
sudo cp deploy/nginx-ip.conf /etc/nginx/sites-available/poke-intel-ip
sudo sed -i "s/SERVER_IP/$SERVER_IP/g" /etc/nginx/sites-available/poke-intel-ip
sudo ln -s /etc/nginx/sites-available/poke-intel-ip /etc/nginx/sites-enabled/poke-intel-ip
sudo nginx -t
sudo systemctl reload nginx
sudo /snap/bin/certbot certonly --preferred-profile shortlived \
  --webroot --webroot-path /var/www/certbot --ip-address "$SERVER_IP"
```

签发成功后再安装 HTTPS 站点模板（证书路径会按这个 IP 填入），并检查证书与后台：

```bash
sudo cp deploy/nginx-ip-https.conf /etc/nginx/sites-available/poke-intel-ip
sudo sed -i "s/SERVER_IP/$SERVER_IP/g" /etc/nginx/sites-available/poke-intel-ip
sudo nginx -t
sudo systemctl reload nginx
curl -f "https://$SERVER_IP/api/v1/status"
```

续期成功后必须让 Nginx 重新读取证书。创建 Certbot 的部署钩子，并检查自动续期定时器：

```bash
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo /snap/bin/certbot renew --dry-run
systemctl list-timers --all | grep -i certbot
```

如果最后没有列出 Certbot 自动续期任务，先排查 snap 的定时器，再开放网站给用户。IP 变化后，证书、Nginx 模板和 `.env` 的来源地址都要更新。证书申请失败时先检查公网 IP 是否真正归这台服务器、80 端口是否从公网可达，以及 `sudo nginx -t` 是否通过；不要把 3001 直接暴露给公网。

## 方式三：GitHub Pages 前端 + Ubuntu 后台

Pages 只发布 `dist/` 中的静态文件。它不能运行 Node、SQLite、Alphapedia 定时抓取或企业微信推送。先按上面任一 Docker 方式在服务器运行后台，再配置 Pages。

**完整账号功能需要同站点域名。**例如后台设为 `https://api.example.com`（`ORIGIN`），Pages 自定义域名设为 `https://app.example.com`。两者都是 HTTPS 且属于同一个主域名，浏览器才会在跨来源 API 请求中发送当前的 `SameSite=Lax` 登录 Cookie。默认的 `用户名.github.io/仓库名` 与 `api.example.com` 不属于同一个站点，登录态无法可靠工作；它只能作为公开情报浏览入口。不要通过放宽 Cookie 安全属性来绕过此限制。

1. 在仓库 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。GitHub Free 的 Pages 适用于公开仓库；私有仓库需确认账户套餐支持。工作流文件为 [pages.yml](../.github/workflows/pages.yml)。
2. 在 **Settings → Secrets and variables → Actions → Variables** 新建仓库变量 `POKE_API_ORIGIN`，值为后台 HTTPS 来源，例如 `https://api.example.com`。不要填路径或末尾斜杠。缺少此变量时 Pages 部署任务会跳过，避免发布不能工作的页面。
3. 项目 Pages 地址通常是 `https://<用户名>.github.io/<仓库名>/`；若账号的用户站点已有自定义域名，也可能显示为 `https://<已有域名>/<仓库名>/`。这两种带仓库路径的地址无需设置 `PAGES_BASE_PATH`，工作流会自动使用 `/<仓库名>/`。如果给**本仓库**设置独立自定义域名，才设置 `PAGES_BASE_PATH=/`，并在 **Settings → Pages → Custom domain** 填 `app.example.com`；按 GitHub 指引把该子域名的 CNAME 指向 `<用户名>.github.io`，然后启用 HTTPS。
4. 在服务器 `.env` 设置 `ORIGIN=https://api.example.com`，`ALLOWED_ORIGINS=https://api.example.com,https://app.example.com`；如果还想让默认 Pages 地址只读访问，也加入 `https://<用户名>.github.io`。重新创建容器使配置生效。`ALLOWED_ORIGINS` 只填写来源，不带仓库路径。
5. 推送到 `main` 后，或在 **Actions → Publish frontend to GitHub Pages → Run workflow** 手动运行。工作流会构建前端并发布。`VITE_ICP_NUMBER` 可作为仓库变量填写实际备案号；它会公开出现在网页中。**不要**把企业微信 Webhook、数据库或加密密钥填入仓库变量或 `VITE_` 变量。

Pages 网页通过浏览器直接请求 `POKE_API_ORIGIN`；后台已按 `ALLOWED_ORIGINS` 对指定来源返回带凭据的跨域响应，仍保留原有的来源和 CSRF 校验。Pages 更新网页需触发工作流；后台代码变更仍要在 Ubuntu 上更新容器。Pages 对中国大陆访客的可用性取决于访问环境，生产入口建议继续使用自有域名服务器。

## 备份、排错与安全

Compose 备份：`docker compose exec -T app node scripts/backup.mjs`；单容器备份：`docker exec poke-intel node scripts/backup.mjs`。SQLite 运行时有 WAL 文件，请使用上述在线备份命令，不要只复制 `poke.db`。异地保存备份和 `.env`；丢失 `SETTINGS_ENCRYPTION_KEY` 后，数据库中已保存的机器人链接无法解密。

常见检查：`docker compose ps` 或 `docker ps`、容器日志、`curl -f http://127.0.0.1:3001/api/v1/status`、`sudo nginx -t`。实时监控需要在 `.env` 同时启用资料库权限确认和对应监控；管理员页面可查看最近检查时间与错误。外部来源接口中断时可能漏掉短暂出现的群聚或奇遇，程序无法保证绝对实时。监控间隔默认 30 秒，但网络和来源延迟会增加通知时间。

相关官方说明：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Pages 自定义域名](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)、[Docker run 参考](https://docs.docker.com/reference/cli/docker/container/run/)。
