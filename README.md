# Poke 情报站

面向公开玩家的中文 PokeMMO 头目/群聚情报网站。支持公开查询、邮箱密码账号、上报、管理员审核、历史筛选、纠错与结束标记。网页适配手机和电脑，接口前缀 `/api/v1`，以后可接入微信小程序。

**数据说明：**首次启动为空数据库，不会显示伪造情报。外部来源尚未接入；取得接口使用许可后再配置。支持企业微信机器人群推送；当前没有图鉴、个人浏览器推送、短信或邮件验证，邮箱仅用作账号标识。情报由玩家提供并经平台审核，不能保证游戏内仍有效；默认 60 分钟截止仅为本站展示规则。

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

浏览器打开 `http://127.0.0.1:5173` 或 `http://localhost:5173`。示例配置已将两个本地地址加入 `ALLOWED_ORIGINS`，不会再因地址写法不同触发“请求来源校验失败”。生产环境只填写实际使用的 HTTPS 域名。

## Alphapedia 刷新资料库

程序可从 Alphapedia 的公开 JSON 接口同步头目、群聚刷新地点、全国图鉴编号和简体中文名称。数据由服务器每 15 分钟更新；同步失败时保留上次成功结果。页面以中文名为主、英文原名为辅，中英文均可搜索。资料库不会被当作正在发生的实时事件，也不会触发企业微信推送。

确认你有权复用并展示该数据后，在 `.env` 中启用：

```env
ALPHAPEDIA_ENABLED=1
ALPHAPEDIA_PERMISSION_CONFIRMED=1
ALPHA_MONITOR_ENABLED=1
ALPHA_MONITOR_INTERVAL_SECONDS=30
```

页面会保留 Alphapedia 来源链接，不复制其图片资源。首次启动会立即同步，之后可在“刷新资料库”中按类型、地区、宝可梦或地点查询。

启用头目实时监控后，后台每 30 秒检查一次 Alphapedia 首页状态。新头目在发布时间后 75 分钟内会自动加入实时情报，并按企业微信设置推送一次；过期状态只用于更新监控游标。去重信息保存在 SQLite，服务器重启不会重复推送。管理员可在“管理后台 → 推送设置”查看最近检查、最近发现和错误状态。

创建管理员：

```powershell
npm run admin -- admin@example.com 管理员
```

命令在终端安全询问密码，不把密码放进命令参数。无默认管理员或默认密码；也可将已有普通账号提升为管理员。

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

以下示例域名 `intel.example.com` 必须替换为你的已备案域名/子域名。服务器尚未自动操作，本项目不会读取或保存你的云服务器密码。

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
docker compose exec app node scripts/admin.mjs admin@example.com 管理员
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

若出现登录安全检查失败，检查 `.env` 中 ORIGIN 是否与地址栏 HTTPS 地址一致。若注册邮箱已存在但忘记密码，首版暂不提供自动找回；管理员需要通过受控运维流程处理，不能直接泄露密码哈希。

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

登录管理员账号后，进入“管理后台 → 推送设置”，即可填写或更换 Webhook、启用或停用、发送测试消息和清除网页配置。网页保存的加密配置优先于 `WECOM_WEBHOOK_URL`；清除网页配置后恢复使用环境变量。页面和接口只显示脱敏标识，不回填完整地址。

**发送规则：**新头目/群聚事件首次审核通过且仍有效时，自动发送中文 Markdown，包含中文宝可梦名称、地区、地点、北京时间和网站筛选链接。重复批准与合并报告不会重复入队；待审、驳回、已结束及已纠错情报不会发送。网站链接使用 ORIGIN 配置，公网使用时必须设置真实 HTTPS 域名。

**队列与重试：**审批与入队在同一数据库事务中完成，网络发送由后台独立处理。网络故障不会中断审批；如果数据库无法写入队列，审批回滚并可重新操作。队列保存在 SQLite，服务重启可继续处理，每次发送至少间隔 3.5 秒。失败最多尝试 6 次，间隔 1、2、4、5、5 分钟；超过次数标记 failed。重试前发现情报已结束、已纠错或展示时间到期则跳过。未配置时不为新审批积累队列，也不会补发启用前的历史情报。

企业微信接口没有本项目可用的远端幂等键；请求已被接收但回应丢失时，重试可能产生重复消息。应用保证每个事件只有一条本地队列记录，不宣称跨网络严格“恰好一次”。

管理员可使用登录态访问 `/api/v1/admin/notifications` 检查开关、队列数量、最近成功时间和脱敏错误。机器人地址不会出现在此接口、公开页面、审计详情或错误记录里。管理后台的“发送测试消息”会向当前机器人发送一条固定测试内容。

本功能依据 [企业微信官方消息推送说明](https://developer.work.weixin.qq.com/document/path/91770)，采用 Markdown 消息（最长 4096 UTF-8 字节），发送节流低于官方每机器人 20 条/分钟限制。开发测试使用隔离的模拟网络传输，没有给真实群发送测试消息。

## 实现资料

- [设计文档](docs/superpowers/specs/2026-10-03-poke-intel-design.md)
- [接口合约](docs/api.md)
- [Node SQLite 官方文档](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Fastify 官方文档](https://fastify.dev/docs/latest/)

Node 24 自带 SQLite 接口仍应注意官方稳定性标识；本项目不安装额外原生 SQLite 插件。当前为单机首版，不宣称具备多实例或高并发架构。
