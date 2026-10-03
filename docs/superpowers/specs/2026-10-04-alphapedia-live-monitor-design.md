# Alphapedia 头目实时监控设计

## 目标

后台持续读取 Alphapedia 首页状态，在发现新的头目刷新时写入本站实时情报，并通过已有企业微信机器人队列及时推送。监控默认每 30 秒运行一次，服务重启后不重复处理已经见过的状态。

## 数据获取

监控器先请求 `https://alpha.pokemmotools.org/`，保存会话 Cookie，并从页面的 `landing-status-token` meta 标签读取令牌。随后使用同一会话请求 `/api/landing-status`，携带令牌、Referer、Accept 和固定 User-Agent。令牌失效、401、403 或会话过期时重新建立会话；普通网络错误按下一轮重试。

状态解析只接受 JSON 中的 `latest_ping_raw`、`latest_ping_time` 和 `latest_ping_details_html`。宝可梦名称来自 `latest_ping_raw`。地区、地点、来源链接和时间戳从详情 HTML 的限定属性及 Alpha List 链接参数中提取；不执行 HTML，不使用远程图片。缺少名称、合法地区、地点或时间戳的响应不入库。

## 去重与有效期

数据库新增 `external_monitor_state`，保存来源、最后成功检查、最后状态标识、最后错误和连续失败次数。事件唯一标识由 Alphapedia 链接中的 Unix 时间戳、英文名称、地区与地点组成，并记录到 `reports.source_event_id`，沿用现有唯一约束保证重启后幂等。

头目有效截止为观察时间后 75 分钟。首次启动时，如果最新头目仍在有效期内，则导入并推送一次；已经过期的记录只更新监控游标，不导入和推送。后续遇到新标识时创建已审核的 external 事件，不进入人工审核队列，并在同一事务中加入企业微信 outbox。已经存在的标识直接跳过。

## 写入和通知

监控写入使用独立函数 `publishExternalEvent`，在一个数据库事务中创建 external report、active event、审计记录和通知 outbox。写入前再次判断有效期。企业微信未启用时仍公开事件，但不创建历史待发消息；以后启用不会补发。

宝可梦显示和推送继续使用现有中文名称映射。来源 URL 固定限制在 `https://alpha.pokemmotools.org/alpha-list`，并保留筛选参数。监控器不读取或复制图片。

## 生命周期和状态

`createAlphaMonitor` 暴露 `start()`、`runOnce()`、`close()` 和 `status()`。同一进程最多允许一轮检查在途；关闭服务时中止网络请求并等待当前任务结束。定时器使用 `unref()`。状态接口返回 enabled、intervalSeconds、lastCheckedAt、lastSuccessAt、lastEvent、consecutiveFailures 和清理后的 lastError，不返回 Cookie 或令牌。

`ALPHA_MONITOR_ENABLED=1` 启用监控，`ALPHA_MONITOR_INTERVAL_SECONDS` 默认 30，允许 15–300。监控依赖 Alphapedia 数据使用开关和许可确认；未同时启用时启动失败并给出明确配置错误。

## 管理界面

管理员“推送设置”页增加“头目实时监控”状态卡，显示是否启用、检查频率、最近成功检查、最近发现和最近错误。此版本不允许网页更改监控频率，避免运行配置与部署配置不一致。

## 错误处理

单次网络、JSON 或解析失败只更新失败状态，不停止服务器、不修改上次成功事件、不触发通知。错误文本最多 300 字符，并移除 URL 查询、Cookie 和令牌。连续失败不会提高请求频率。成功后失败计数和错误清零。

## 验证

测试覆盖会话与令牌请求、字段解析、首次有效状态、首次过期状态、重复轮询、重启幂等、新状态发布、中文推送、机器人关闭、不合法响应、令牌重建、失败后恢复、并发 `runOnce` 和关闭中止。浏览器测试覆盖管理员监控状态展示。最后运行全部 Node 测试、构建、生产检查、Playwright 测试，并用真实 Alphapedia 状态执行一次只读解析验证。
