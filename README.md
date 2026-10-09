# Poke 情报站

**部署入口：**[Ubuntu、Docker Compose、docker run、无域名公网 IP HTTPS 与 GitHub Pages 详细指南](docs/DEPLOYMENT.md)。GitHub Pages 仅承载前端，账号、实时监控和企业微信推送仍需服务器后台。

面向公开玩家的中文 PokeMMO 头目、群聚与合众奇遇情报网站。支持公开查询、用户名密码账号、上报、管理员审核、历史筛选、纠错与结束标记。网页适配手机和电脑，接口前缀 `/api/v1`，以后可接入微信小程序。

**数据说明：**首次启动为空数据库，不会显示伪造情报。配置外部来源后可同步 Alphapedia 数据。支持企业微信机器人群推送；当前没有个人浏览器推送、短信或自动密码找回。玩家情报经管理员审核后展示；外部头目记录按来源时间自动展示，是否仍有效请以游戏内情况为准。

## 快速启动（已有源码）

服务器已安装 Docker、源码在 `/opt/poke-intel` 时，只需把下面的示例 IP 换成真实公网 IPv4，然后执行：

```bash
git -C /opt/poke-intel pull --ff-only && bash /opt/poke-intel/deploy/quickstart.sh 你的公网IP
```

全新服务器已安装 Docker 时，可用 `git clone https://github.com/dll315/poke-intel.git /opt/poke-intel && bash /opt/poke-intel/deploy/quickstart.sh 你的公网IP`。脚本会修正 `.env` 中的 HTTPS `ORIGIN`、补齐加密密钥并保留原有数据库卷；优先拉取[公开的 GitHub 预构建镜像](https://github.com/users/dll315/packages/container/package/poke-intel)，下载失败时使用本机已有的 `poke-intel:local` 镜像。脚本确认的是**本机后台**启动；公网网页仍需按[HTTPS 步骤](docs/DEPLOYMENT.md#无域名公网-ip--https)配置证书和反向代理，安全组开放 80/443。

## Linux 用 `docker run` 部署（无域名）

这是本仓库的完整网站部署方式，网页、账号、数据库、实时监控和企业微信推送都在同一个容器中运行。**先安装 Docker Engine，准备公网 IP，并在云服务器安全组开放 80/443；3001 不对公网开放。**Docker 容器命令适用于 Ubuntu 和 OpenCloudOS；两者安装 Nginx、证书工具的系统命令不同，OpenCloudOS 不要照抄 Ubuntu 的 `apt` 命令。无域名时使用 [公网 IP 证书与 Nginx 的详细步骤](docs/DEPLOYMENT.md#无域名公网-ip--https)提供 HTTPS。以下命令在服务器执行：

```bash
sudo mkdir -p /opt/poke-intel
sudo chown "$USER":"$USER" /opt/poke-intel
git clone https://github.com/dll315/poke-intel.git /opt/poke-intel
cd /opt/poke-intel
cp .env.example .env
openssl rand -hex 32
```

如果 `ls -l /opt/poke-intel/Dockerfile` 已能看到文件，就跳过上面的 `mkdir`、`chown` 和 `git clone`，直接 `cd /opt/poke-intel`；已有 `.env` 时也不要覆盖。**单独运行** `nano .env`，编辑完成后按 Ctrl+O、回车、Ctrl+X 退出，再单独运行 `chmod 600 .env`。不要把编辑器命令和后续命令整段粘贴，否则后续文字可能写进 `.env`。

把生成的 64 位十六进制密钥填入 `.env` 的 `SETTINGS_ENCRYPTION_KEY`。同时将 `ORIGIN`、`ALLOWED_ORIGINS` 都改为 `https://你的实际公网IP`，并设置 `NODE_ENV=production`、`HOST=0.0.0.0`、`TRUST_PROXY=1`；不要保留示例中的 `localhost`。如确认可复用 Alphapedia 数据，再按[数据接入说明](docs/DEPLOYMENT.md#发布前准备)开启对应监控。

```bash
cd /opt/poke-intel
ls -l Dockerfile package-lock.json .env
docker build -t poke-intel:local .
```

**必须等构建成功后再运行下一段。** 如果出现 `EOF` 或其他构建错误，镜像尚未生成；先看[构建中断排查](docs/DEPLOYMENT.md#构建中断或-eof)，不要继续执行 `docker run`。

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

确认容器已运行，再单独创建管理员（会在终端交互输入密码）：

```bash
docker ps --filter name=poke-intel
docker logs --tail 100 poke-intel
curl -f http://127.0.0.1:3001/api/v1/status
```

```bash
docker exec -it poke-intel node scripts/admin.mjs admin 管理员
```

`ls` 必须同时列出 `Dockerfile`、`package-lock.json` 和 `.env`，再执行后面的命令。若显示文件不存在，先看[当前目录错误的恢复步骤](docs/DEPLOYMENT.md#找不到-dockerfile-时)。管理员命令会在终端询问密码。容器启动后，按[公网 IP HTTPS 步骤](docs/DEPLOYMENT.md#无域名公网-ip--https)安装 Nginx 和证书，最终访问 `https://你的实际公网IP`。先用 `curl -f http://127.0.0.1:3001/api/v1/status` 检查后台；Ubuntu 未安装 `curl` 时执行 `sudo apt install curl`，OpenCloudOS 使用 `sudo dnf install curl`。数据库保存在 `poke-intel-data`，更新时不要删除这个卷。完整的[备份、更新和排错命令](docs/DEPLOYMENT.md#方式二单容器-docker-run)在部署指南中。

## 本地启动

需要 Node.js 24.19 或更高的 24.x、npm。使用 Node 原生 SQLite，数据库默认位于 `data/poke.db`，该目录、`.env` 均不进入版本控制。

```powershell
npm install
Copy-Item .env.example .env
npm run server
```

另开终端启动网页：

```powershell
npm run dev
```

浏览器打开 `http://127.0.0.1:5173` 或 `http://localhost:5173`。示例配置已将两个本地地址加入 `ALLOWED_ORIGINS`，不会再因地址写法不同触发“请求来源校验失败”。生产环境只填写实际使用的 HTTPS 域名或公网 IP 来源。

## Alphapedia 刷新资料库

程序可从 Alphapedia 的公开 JSON 接口同步头目、群聚刷新地点、全国图鉴编号和简体中文名称。数据由服务器每分钟更新；同步失败时保留上次成功结果。页面以中文名为主、英文原名为辅，中英文均可搜索。资料库不会被当作正在发生的实时事件，也不会触发企业微信推送。

确认你有权复用并展示该数据后，在 `.env` 中启用：

```env
ALPHAPEDIA_ENABLED=1
ALPHAPEDIA_PERMISSION_CONFIRMED=1
ALPHA_MONITOR_ENABLED=1
ALPHA_MONITOR_INTERVAL_SECONDS=30
SWARM_MONITOR_ENABLED=1
SWARM_MONITOR_INTERVAL_SECONDS=30
PHENO_MONITOR_ENABLED=1
PHENO_MONITOR_INTERVAL_SECONDS=30
```

页面会保留 Alphapedia 来源链接，不复制其图片资源。首次启动会立即同步，之后可在“刷新资料库”中按类型、地区、宝可梦或地点查询。

启用实时监控后，后台每 30 秒分别检查 Alphapedia 的头目历史、群聚历史和首页活跃奇遇。头目历史接口不可用时退回首页摘要；群聚或奇遇接口失败会记录错误并在下次检查重试。头目按来源时间判断是否有效；普通群聚约 20 分钟结束，奇遇约 10 分钟结束，且来源页面撤下活跃奇遇后会提前结束。去重信息保存在 SQLite，服务器重启不会重复推送。管理员可在“管理后台 → 推送设置”查看三类监控的最近检查、发现和错误状态。

创建管理员：

```powershell
npm run admin -- admin 管理员
```

命令在终端安全询问密码，不把密码放进命令参数。已有管理员可使用 `npm run admin -- admin 管理员 --reset-password` 重设密码并退出旧会话。普通用户可自行注册，用户名仅接受 3–30 位英文字母、数字、下划线或短横线，密码至少 10 位。

## 验证与构建

```powershell
npm test
npm run build
npm run test:production
npx playwright install chromium
npm run test:ui
```

浏览器测试使用独立临时数据库，不影响开发数据库。`npm run build` 生成 `dist/`；后台可直接提供该构建后的网页。生产模式必须使用 HTTPS Origin。

## Ubuntu 部署

以下示例域名 `intel.example.com` 必须替换为你的实际域名；**没有域名时请使用[公网 IP + HTTPS 步骤](docs/DEPLOYMENT.md#无域名公网-ip--https)**。服务器尚未自动操作，本项目不会读取或保存你的云服务器密码。

### 1. 准备域名与运行环境

将域名 A 记录指向服务器公网 IP，在安全组放行 TCP 80/443；不要公网开放 3001。保留已有 SSH 和其他服务规则。安装 Docker Engine + Compose 插件，参考 [Docker 官方 Ubuntu 指南](https://docs.docker.com/engine/install/ubuntu/)。安装 Nginx 和 Certbot：

```bash
sudo apt update
sudo apt install nginx certbot
```

如果已有 Nginx 或其他网站，增加独立站点配置，不覆盖现有配置。将源码（包含 package-lock.json）上传到 `/opt/poke-intel`：

```bash
cd /opt/poke-intel
cp .env.example .env
nano .env
```

设置：

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
ORIGIN=https://intel.example.com
DB_PATH=/app/data/poke.db
TRUST_PROXY=1
VITE_ICP_NUMBER=
```

限制环境文件读取权限，并准备备份目录（容器应用以 uid 1000 运行）：

```bash
chmod 600 .env
sudo install -d -o 1000 -g 1000 -m 700 /opt/poke-intel/backups
docker compose up -d --build
docker compose exec app node scripts/admin.mjs admin 管理员
docker compose ps
```

Docker 从配置挂载独立 `poke-data` 命名卷，升级镜像不会清空数据库。**不要执行 `docker compose down -v`**，该命令会删除数据卷。首次镜像构建需要访问镜像仓库和 npm；若网络不通，需要服务器网络可达或事先导入构建好的镜像。

生产 Compose 只将后台绑定到服务器回环地址，并信任一层反向代理，用于按真实访客 IP 限流。Nginx 必须覆盖客户端传入的 X-Forwarded-For；不得将后台端口直接开放到公网。直接运行后台或开发时保持 `TRUST_PROXY=0`。

### 2. 配置 HTTPS

复制 `deploy/nginx.conf` 为 `/etc/nginx/sites-available/poke-intel`，替换域名。建立软链接：

```bash
sudo mkdir -p /var/www/certbot
sudo ln -s /etc/nginx/sites-available/poke-intel /etc/nginx/sites-enabled/poke-intel
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d intel.example.com
```

证书申请成功后，用 `deploy/nginx-https.conf` 替换该站点配置，再次替换域名（包含证书路径），然后：

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

确保系统定时任务在证书续期后 reload Nginx，例如添加 `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`：

```sh
#!/bin/sh
nginx -t && systemctl reload nginx
```

设置该脚本可执行权限。打开 HTTPS 域名，注册普通账号、提交情报，用管理员审批，最后在退出登录状态确认公开显示。

备案展示：上线前将 `.env` 的 `VITE_ICP_NUMBER` 填为你实际的 ICP 备案号并重新构建；页脚链接指向官方查询网站。公安备案等展示信息按你已办理的情况配置。不要使用示例号码。备案号是公开信息，不能把密码或密钥写入任何 `VITE_` 变量。

### 3. 备份与恢复

备份采用 SQLite 在线备份 API，包含 WAL 中已提交的数据，不能简单只复制主数据库文件。备份位于服务器 `/opt/poke-intel/backups`，不是公开网页目录。

```bash
cd /opt/poke-intel
docker compose exec -T app node scripts/backup.mjs
```

建议加入服务器 crontab，每日一次，并自行设置保留期和异地备份。任何现有备份文件均不会被命令覆盖。恢复前停止应用，完整备份现有数据并确认需要回滚；示例：

```bash
docker compose stop app
docker compose run --rm --no-deps app node scripts/restore.mjs /app/backups/你的备份.db --confirm-server-stopped --overwrite
docker compose up -d app
```

恢复会替换数据库并移除目标旧 WAL/SHM，**确认应用已停止**是操作前提，脚本不能替你证明其他进程均已关闭。测试或第一次恢复到不存在的数据库时无需 `--overwrite`。

### 4. 更新与排错

更新前做备份，替换源码后运行 `docker compose up -d --build`。检查 `docker compose logs --tail 100 app`；不要将日志、密码或 `.env` 发布到网站。健康检查路径为 `/api/v1/status`。

若出现登录安全检查失败，检查 `.env` 中 ORIGIN 是否与地址栏 HTTPS 地址一致。普通用户忘记密码时，首版暂不提供自动找回；管理员需要通过受控运维流程处理，不能直接泄露密码哈希。

## 企业微信机器人群推送

在希望接收通知的企业微信群中添加机器人/消息推送，取得 Webhook 地址。在服务器 `.env` 添加完整地址：

```dotenv
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=你的机器人key
SETTINGS_ENCRYPTION_KEY=使用下方命令生成的固定密钥
```

这不是网页环境变量，不要添加 `VITE_` 前缀，也不要放入前端源码或提交到 Git。Compose 仅将它传入后台容器。

生成管理后台保存机器人配置所需的密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

将结果只保存到服务器 `.env`。丢失或更换该密钥后，数据库中已经保存的机器人地址无法解密，需要在管理后台重新填写。数据库备份不包含这把密钥，应将 `.env` 单独安全备份。

已有服务启用配置后运行：

```bash
docker compose up -d app
```

首次更新到支持推送的版本，需先上传新源码并运行 `docker compose up -d --build`。数据库新增队列表自动建立，既有数据保留。非 Docker 启动时，`npm run server` 自动读取 `.env`；更改配置后重启后台。后台只接受企业微信官方 HTTPS 发送地址，不跟随重定向。

登录管理员账号后，进入“管理后台 → 推送设置”，可以填写主机器人 Webhook，也可在“推送链接管理”中添加多个机器人链接，逐个启用、停用、测试或删除。每个机器人可分别勾选头目、群聚、玩家报点和奇遇推送；头目/群聚/奇遇指 Alphapedia 自动同步，玩家报点指本站玩家提交并审核通过的情报。旧机器人默认接收全部四类，修改后只影响新情报。网页保存的主机器人配置优先于 `WECOM_WEBHOOK_URL`；清除主机器人网页配置后恢复使用环境变量。所有链接加密保存，页面和接口只显示脱敏标识，不回填完整地址。

**发送规则：**符合机器人勾选类别的新情报首次发布且仍有效时，自动发送中文 Markdown，包含中文宝可梦名称、地区、地点、北京时间和网站筛选链接。奇遇卡片只在 Alphapedia 标记为活跃时同步，来源不提供完整奇遇历史，服务中断期间已消失的奇遇无法补抓。重复批准与合并报告不会重复入队；待审、驳回、已结束及已纠错情报不会发送。网站链接使用 ORIGIN 配置，公网使用时必须设置真实 HTTPS 域名。

玩家上报奇遇时可选择草丛摇动、尘土、水面波纹或飞行阴影，地区固定为合众；如果尚未确认宝可梦，可以留空名称。奇遇报告和其他玩家报告一样进入管理员审核队列，审核通过后按“玩家报点推送”发送。
奇遇地点候选项从 Alphapedia 的奇遇资料同步，按形式筛选区域，并在已知区域提供中文地点、具体点位和原始点位图；未确认的名称保留来源原文。不确定或来源未收录时仍可手动填写。同步失败会保留上次成功的地点缓存。

**队列与重试：**审批与入队在同一数据库事务中完成，网络发送由后台独立处理。网络故障不会中断审批；如果数据库无法写入队列，审批回滚并可重新操作。队列保存在 SQLite，服务重启可继续处理，每次发送至少间隔 3.5 秒。每个机器人独立记录发送结果，某个链接失败不会让已经成功的链接重复发送。失败最多尝试 6 次，间隔 1、2、4、5、5 分钟；超过次数标记 failed。重试前发现情报已结束、已纠错或展示时间到期则跳过。未配置时不为新审批积累队列，也不会补发启用前的历史情报。

企业微信接口没有本项目可用的远端幂等键；请求已被接收但回应丢失时，重试可能产生重复消息。应用为每个事件和每个机器人分别保存本地发送状态，不宣称跨网络严格“恰好一次”。

管理员可使用登录态访问 `/api/v1/admin/notifications` 检查开关、队列数量、最近成功时间和脱敏错误。机器人地址不会出现在此接口、公开页面、审计详情或错误记录里。管理后台的“发送测试消息”会向当前机器人发送一条固定测试内容。

本功能依据 [企业微信官方消息推送说明](https://developer.work.weixin.qq.com/document/path/91770)，采用 Markdown 消息（最长 4096 UTF-8 字节），发送节流低于官方每机器人 20 条/分钟限制。开发测试使用隔离的模拟网络传输，没有给真实群发送测试消息。

## 实现资料

- [设计文档](docs/superpowers/specs/2026-10-03-poke-intel-design.md)
- [接口合约](docs/api.md)
- [Node SQLite 官方文档](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Fastify 官方文档](https://fastify.dev/docs/latest/)

Node 24 自带 SQLite 接口仍应注意官方稳定性标识；本项目不安装额外原生 SQLite 插件。当前为单机首版，不宣称具备多实例或高并发架构。
