# API 合约

所有接口位于 `/api/v1`，JSON 请求与响应。写请求必须带 `Origin`（开发默认 `http://localhost:3001`，网页开发时使用配置的 Origin）。登录后写请求还必须带 `X-CSRF-Token`，值来自身份响应。浏览器请求使用 `credentials: 'same-origin'`。身份使用 HttpOnly 会话 Cookie。

错误：`{error: string, fields?: Record<string,string>}`，401 未登录，403 无权限或安全检查失败，404 未找到，409 冲突，422 字段错误，429 限流。

列表：`{items: T[], total: number, page: number, pageSize: number}`。查询参数 `page`（默认 1）、`pageSize`（默认 20，最大 100）。

## 身份

- `GET /auth/me` → `{user: User|null, csrfToken: string}`；匿名也取得 CSRF token，但注册、登录仅要求 Origin。
- `POST /auth/register` 输入 `{username,nickname,password}`，201 → `{user,csrfToken}`，自动登录。
- `POST /auth/login` 输入 `{username,password}`，200 → `{user,csrfToken}`。
- `POST /auth/logout` → `{ok:true}`，需要会话和 CSRF。

User：`{id:number,username:string,nickname:string,role:'user'|'admin',disabled:boolean}`。普通用户密码 10–128 字符、昵称 1–30 字符；用户名 3–30 位，仅接受英文字母、数字、下划线和短横线，大小写不敏感。`admin` 保留给管理员。

## 情报

Event：`{id,kind,pokemon,pokemonOriginal,region,location,observedAt,expiresAt,lastConfirmedAt,status,source,sourceUrl,note,contributors,correctionReason}`。已知英文名称在 `pokemon` 中返回中文，`pokemonOriginal` 保留数据库原值。时间为 UTC ISO 字符串；kind 为 `boss|swarm|pheno`；region 为 `kanto|johto|hoenn|sinnoh|unova`；status 为 `active|ended|corrected`；source 为 `player|external|demo`；sourceUrl 为 URL 或 null；contributors 为 `{nickname:string}[]`；correctionReason 为 string 或 null。

- `GET /events` → Event 列表。默认仅 active；支持 `view=history`（全部已发布状态）、`kind,region,q,status,dateFrom,dateTo`，日期为北京时间 `YYYY-MM-DD`，包含两端。
- `GET /events/:id` → Event。
- `GET /status` → `{externalSourcesEnabled:boolean,demoMode:false,serverTime:string}`。
- `GET /catalog`：查询 Alphapedia 刷新资料库，支持 `q`、`kind`、`region`、`page` 和 `pageSize`；条目同时返回中文 `pokemon` 与英文 `pokemonOriginal`，`q` 匹配两者。
- `GET /catalog/status`：返回资料库启用状态、缓存数量、最近同步时间和最近一次错误。
- `GET /pheno-locations`：返回 Alphapedia 合众奇遇地点缓存，包含 `items:[{area,type,detail,mapUrl}]`、最近同步时间和错误。`type` 为 `grass|dust|water|shadow`；来源记录的区域与点位名称保持原样。

## 上报

Report：`{id,kind,pokemon,region,location,observedAt,note,status,reason,eventId,source,sourceUrl,createdAt,reporter}`。status 为 `pending|approved|rejected`；reason 和 eventId 为 null 或具体值；reporter 为 `{nickname:string}`。

- `POST /reports` 输入 `{kind,pokemon,region,location,observedAt,note?,phenomenonType?}`，201 → Report；登录且 CSRF。普通报告的 pokemon 为 1–50 字符；`kind=pheno` 时 region 必须为 `unova`、`phenomenonType` 必须为 `grass|dust|water|shadow`，pokemon 可留空并存为“未知宝可梦”。location 1–100 字符，note 最大 1000，观察时间不得未来或早于 24 小时。每用户每分钟 3 次，每北京时间自然日 50 次。
- `GET /reports/mine` → 当前用户 Report 列表，可筛选 `status`。

## 管理员

- `GET /admin/notifications` → `{enabled,counts:{pending,sending,sent,failed,skipped},lastSentAt,lastError}`。只允许管理员查看，不返回 Webhook 或机器人 key。配置留空时 enabled=false。
- `GET /admin/settings/notifications`：返回启用状态、主机器人的 `categories`、配置来源、脱敏标识、是否可网页保存及队列状态，不返回完整 Webhook。
- `PUT /admin/settings/notifications` 输入 `{enabled:boolean,webhookUrl?:string,categories?:('boss'|'swarm'|'player'|'pheno')[]}`：保存启用状态、接收类别，并在提供 Webhook 时加密保存。
- `DELETE /admin/settings/notifications/webhook`：删除数据库中的 Webhook，恢复环境变量后备配置。
- `POST /admin/settings/notifications/test`：向当前启用的机器人发送固定测试消息。
- `GET /admin/monitor`：返回 Alphapedia 头目监控的启用状态、检查频率、最近检查、最近成功、最近事件、连续失败次数和脱敏错误。
- `GET /admin/monitor/swarm`：返回同样结构的群聚监控状态。
- `GET /admin/monitor/pheno`：返回同样结构的奇遇监控状态。
- `GET /admin/settings/notification-links`：列出额外企业微信机器人链接及各自的 `categories`，地址只返回脱敏标识。
- `POST /admin/settings/notification-links` 输入 `{label,webhookUrl,enabled?,categories?}`：加密添加机器人链接。
- `PATCH /admin/settings/notification-links/:id` 输入可选 `{label,webhookUrl,enabled,categories}`：修改名称、地址、启用状态或接收类别。
- `DELETE /admin/settings/notification-links/:id`：删除链接；`POST /admin/settings/notification-links/:id/test`：只向该链接发送测试消息。

- `GET /admin/reports` → Report 列表，默认 pending，可筛选 `status`。
- `POST /admin/reports/:id/review` 输入 `{action:'approve'|'reject',reason?,expiresAt?}` → `{report:Report,event:Event|null}`。驳回必须填写 reason（1–500）；默认有效截止为 observedAt 后 60 分钟。重复批准返回原结果，不能变更已审结果（409）。
- `GET /admin/events` → Event 列表，默认历史全部，支持公开列表筛选。
- `PATCH /admin/events/:id` 输入可选 `{kind,pokemon,region,location,note,expiresAt,status,correctionReason}` → Event。status 可 active/ended/corrected；corrected 必须给纠错说明。
- `GET /admin/users` → User 列表，支持 `q`（用户名、昵称）。
- `PATCH /admin/users/:id` 输入 `{disabled:boolean}` → User。停用立即撤销全部会话；最后一位启用的管理员不能停用（409）。

所有管理员写操作、报告审核、情报修改和账号停用/恢复写入审计日志。

## 部署边界

`TRUST_PROXY=1` 仅信任来自回环或私有网络、紧邻后台的一跳代理，用于按实际客户端地址限流。只在后台无法从公网直接访问、受控入口覆盖 `X-Forwarded-For` 为真实客户端地址时启用；默认关闭且忽略客户端伪造的代理头。`ALLOWED_ORIGINS` 是逗号分隔的精确来源列表，本地可同时填写 `localhost` 和 `127.0.0.1`；生产环境只填写实际 HTTPS 域名。`SETTINGS_ENCRYPTION_KEY` 必须是固定的 32 字节十六进制或 Base64 密钥，用于加密管理后台保存的 Webhook。生产服务器必须设置 `NODE_ENV=production` 和明确的 HTTPS `ORIGIN`；生产脚本 CSP 不允许内联脚本。
