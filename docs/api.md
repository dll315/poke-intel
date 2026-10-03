# API 合约

所有接口位于 `/api/v1`，JSON 请求与响应。写请求必须带 `Origin`（开发默认 `http://localhost:3001`，网页开发时使用配置的 Origin）。登录后写请求还必须带 `X-CSRF-Token`，值来自身份响应。浏览器请求使用 `credentials: 'same-origin'`。身份使用 HttpOnly 会话 Cookie。

错误：`{error: string, fields?: Record<string,string>}`，401 未登录，403 无权限或安全检查失败，404 未找到，409 冲突，422 字段错误，429 限流。

列表：`{items: T[], total: number, page: number, pageSize: number}`。查询参数 `page`（默认 1）、`pageSize`（默认 20，最大 100）。

## 身份

- `GET /auth/me` → `{user: User|null, csrfToken: string}`；匿名也取得 CSRF token，但注册、登录仅要求 Origin。
- `POST /auth/register` 输入 `{email,nickname,password}`，201 → `{user,csrfToken}`，自动登录。
- `POST /auth/login` 输入 `{email,password}`，200 → `{user,csrfToken}`。
- `POST /auth/logout` → `{ok:true}`，需要会话和 CSRF。

User：`{id:number,email:string,nickname:string,role:'user'|'admin',disabled:boolean}`。密码 10–128 字符、昵称 1–30 字符、邮箱最大 254 字符。

## 情报

Event：`{id,kind,pokemon,region,location,observedAt,expiresAt,lastConfirmedAt,status,source,sourceUrl,note,contributors,correctionReason}`。时间为 UTC ISO 字符串；kind 为 `boss|swarm`；region 为 `kanto|johto|hoenn|sinnoh|unova`；status 为 `active|ended|corrected`；source 为 `player|external|demo`；sourceUrl 为 URL 或 null；contributors 为 `{nickname:string}[]`；correctionReason 为 string 或 null。

- `GET /events` → Event 列表。默认仅 active；支持 `view=history`（全部已发布状态）、`kind,region,q,status,dateFrom,dateTo`，日期为北京时间 `YYYY-MM-DD`，包含两端。
- `GET /events/:id` → Event。
- `GET /status` → `{externalSourcesEnabled:false,demoMode:false,serverTime:string}`。

## 上报

Report：`{id,kind,pokemon,region,location,observedAt,note,status,reason,eventId,source,sourceUrl,createdAt,reporter}`。status 为 `pending|approved|rejected`；reason 和 eventId 为 null 或具体值；reporter 为 `{nickname:string}`。

- `POST /reports` 输入 `{kind,pokemon,region,location,observedAt,note?}`，201 → Report；登录且 CSRF。pokemon 1–50 字符，location 1–100，note 最大 1000，观察时间不得未来或早于 24 小时。每用户每分钟 3 次，每北京时间自然日 50 次。
- `GET /reports/mine` → 当前用户 Report 列表，可筛选 `status`。

## 管理员

- `GET /admin/reports` → Report 列表，默认 pending，可筛选 `status`。
- `POST /admin/reports/:id/review` 输入 `{action:'approve'|'reject',reason?,expiresAt?}` → `{report:Report,event:Event|null}`。驳回必须填写 reason（1–500）；默认有效截止为 observedAt 后 60 分钟。重复批准返回原结果，不能变更已审结果（409）。
- `GET /admin/events` → Event 列表，默认历史全部，支持公开列表筛选。
- `PATCH /admin/events/:id` 输入可选 `{kind,pokemon,region,location,note,expiresAt,status,correctionReason}` → Event。status 可 active/ended/corrected；corrected 必须给纠错说明。
- `GET /admin/users` → User 列表，支持 `q`（邮箱、昵称）。
- `PATCH /admin/users/:id` 输入 `{disabled:boolean}` → User。停用立即撤销全部会话；最后一位启用的管理员不能停用（409）。

所有管理员写操作、报告审核、情报修改和账号停用/恢复写入审计日志。

## 部署边界

`TRUST_PROXY=1` 仅信任来自回环或私有网络、紧邻后台的一跳代理，用于按实际客户端地址限流。只在后台无法从公网直接访问、受控入口覆盖 `X-Forwarded-For` 为真实客户端地址时启用；默认关闭且忽略客户端伪造的代理头。生产服务器必须设置 `NODE_ENV=production` 和明确的 HTTPS `ORIGIN`；生产脚本 CSP 不允许内联脚本。
