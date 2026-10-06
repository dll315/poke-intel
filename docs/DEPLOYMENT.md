# 部署指南

本项目有网页和 Node.js 后台两部分。后台负责账号、SQLite 数据库、Alphapedia 定时检查和企业微信推送，必须保持运行。推荐在 Ubuntu 服务器上用 Docker Compose 或 `docker run` 部署完整网站；GitHub Pages 只能托管前端文件，仍需另行部署后台。

## 发布前准备

1. 准备一个指向服务器公网 IP 的域名，例如 `intel.example.com`。在中国大陆提供公网网站时，按接入商要求完成域名备案。安全组开放 80、443 和现有 SSH 端口；不要开放 3001。
2. 在服务器安装 [Docker Engine 与 Compose 插件](https://docs.docker.com/engine/install/ubuntu/)、Nginx 和 Certbot。4 核 4 GB 的单机可先用此方案；数据库使用一个持久卷，**不要启动多个共享该库的后台副本**。
3. 从 GitHub 克隆仓库，进入项目目录。以下命令假定目录为 `/opt/poke-intel`，域名和仓库地址均需替换：

   ```bash
   sudo mkdir -p /opt/poke-intel
   sudo chown "$USER":"$USER" /opt/poke-intel
   git clone https://github.com/OWNER/REPO.git /opt/poke-intel
   cd /opt/poke-intel
   cp .env.example .env
   nano .env
   chmod 600 .env
   ```

4. 至少将 `.env` 中的 `ORIGIN` 设为 `https://intel.example.com`，`NODE_ENV=production`、`HOST=0.0.0.0`、`PORT=3001`、`TRUST_PROXY=1`、`ALLOWED_ORIGINS=https://intel.example.com`。如果使用 Pages 自定义域名，再把 Pages 域名以逗号加入 `ALLOWED_ORIGINS`。`SETTINGS_ENCRYPTION_KEY` 用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成并妥善保存；如果服务器未安装 Node，可在本地生成后粘贴。只有确认可以复用 Alphapedia 数据时，才把 `ALPHAPEDIA_ENABLED`、`ALPHAPEDIA_PERMISSION_CONFIRMED`、`ALPHA_MONITOR_ENABLED`、`SWARM_MONITOR_ENABLED`、`PHENO_MONITOR_ENABLED` 设为 `1`。机器人链接可在管理员页面填写，不要提交到 Git。

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
docker build --build-arg VITE_ICP_NUMBER=你的实际备案号 -t poke-intel:local .
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
docker logs --tail 100 poke-intel
docker exec -it poke-intel node scripts/admin.mjs admin 管理员
```

未取得备案号时，将 `--build-arg VITE_ICP_NUMBER=...` 整段去掉。`ORIGIN`、`ALLOWED_ORIGINS`、监控和机器人配置仍由 `.env` 提供。更新时先 `docker exec poke-intel node scripts/backup.mjs`，然后拉取代码、重新 `docker build`，执行 `docker stop poke-intel`、`docker rm poke-intel`，再用**同一条** `docker run` 命令启动；不要删除 `poke-intel-data` 卷。检查状态可运行 `curl -f http://127.0.0.1:3001/api/v1/status`。

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

## 方式三：GitHub Pages 前端 + Ubuntu 后台

Pages 只发布 `dist/` 中的静态文件。它不能运行 Node、SQLite、Alphapedia 定时抓取或企业微信推送。先按上面任一 Docker 方式在服务器运行后台，再配置 Pages。

**完整账号功能需要同站点域名。**例如后台设为 `https://api.example.com`（`ORIGIN`），Pages 自定义域名设为 `https://app.example.com`。两者都是 HTTPS 且属于同一个主域名，浏览器才会在跨来源 API 请求中发送当前的 `SameSite=Lax` 登录 Cookie。默认的 `用户名.github.io/仓库名` 与 `api.example.com` 不属于同一个站点，登录态无法可靠工作；它只能作为公开情报浏览入口。不要通过放宽 Cookie 安全属性来绕过此限制。

1. 在仓库 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。GitHub Free 的 Pages 适用于公开仓库；私有仓库需确认账户套餐支持。工作流文件为 [pages.yml](../.github/workflows/pages.yml)。
2. 在 **Settings → Secrets and variables → Actions → Variables** 新建仓库变量 `POKE_API_ORIGIN`，值为后台 HTTPS 来源，例如 `https://api.example.com`。不要填路径或末尾斜杠。缺少此变量时 Pages 部署任务会跳过，避免发布不能工作的页面。
3. 默认 Pages 地址 `https://<用户名>.github.io/<仓库名>/` 时，无需设置 `PAGES_BASE_PATH`，工作流会自动使用 `/<仓库名>/`。如果使用自定义域名，设置 `PAGES_BASE_PATH=/`，并在 **Settings → Pages → Custom domain** 填 `app.example.com`；按 GitHub 指引把该子域名的 CNAME 指向 `<用户名>.github.io`，然后启用 HTTPS。
4. 在服务器 `.env` 设置 `ORIGIN=https://api.example.com`，`ALLOWED_ORIGINS=https://api.example.com,https://app.example.com`；如果还想让默认 Pages 地址只读访问，也加入 `https://<用户名>.github.io`。重新创建容器使配置生效。`ALLOWED_ORIGINS` 只填写来源，不带仓库路径。
5. 推送到 `main` 后，或在 **Actions → Publish frontend to GitHub Pages → Run workflow** 手动运行。工作流会构建前端并发布。`VITE_ICP_NUMBER` 可作为仓库变量填写实际备案号；它会公开出现在网页中。**不要**把企业微信 Webhook、数据库或加密密钥填入仓库变量或 `VITE_` 变量。

Pages 网页通过浏览器直接请求 `POKE_API_ORIGIN`；后台已按 `ALLOWED_ORIGINS` 对指定来源返回带凭据的跨域响应，仍保留原有的来源和 CSRF 校验。Pages 更新网页需触发工作流；后台代码变更仍要在 Ubuntu 上更新容器。Pages 对中国大陆访客的可用性取决于访问环境，生产入口建议继续使用自有域名服务器。

## 备份、排错与安全

Compose 备份：`docker compose exec -T app node scripts/backup.mjs`；单容器备份：`docker exec poke-intel node scripts/backup.mjs`。SQLite 运行时有 WAL 文件，请使用上述在线备份命令，不要只复制 `poke.db`。异地保存备份和 `.env`；丢失 `SETTINGS_ENCRYPTION_KEY` 后，数据库中已保存的机器人链接无法解密。

常见检查：`docker compose ps` 或 `docker ps`、容器日志、`curl -f http://127.0.0.1:3001/api/v1/status`、`sudo nginx -t`。实时监控需要在 `.env` 同时启用资料库权限确认和对应监控；管理员页面可查看最近检查时间与错误。外部来源接口中断时可能漏掉短暂出现的群聚或奇遇，程序无法保证绝对实时。监控间隔默认 30 秒，但网络和来源延迟会增加通知时间。

相关官方说明：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Pages 自定义域名](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)、[Docker run 参考](https://docs.docker.com/reference/cli/docker/container/run/)。
