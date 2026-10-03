import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

test.beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import {openDb} from './server/db.mjs'; import {createUser} from './server/auth.mjs'; const db=openDb(process.env.UI_DB_PATH);if(!db.prepare('SELECT id FROM users WHERE email=?').get('browser-admin@example.com'))createUser(db,{email:'browser-admin@example.com',nickname:'审核管理员',password:'browser-admin-password',role:'admin'});db.close();",
    ],
    { env: process.env },
  );
});

test("公开空状态可浏览，清楚显示外部来源尚未接入", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "实时情报", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("外部情报尚未接入", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("暂无有效情报", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "历史查询", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "历史查询", exact: true }),
  ).toBeVisible();
  await page.getByLabel("开始日期").fill("2026-01-01");
  await page.getByRole("button", { name: "查询历史", exact: true }).click();
  await expect(page).toHaveURL(/from=2026-01-01/);
});

test("资料库展示 Alphapedia 来源并支持搜索", async ({ page }) => {
  await page.route("**/api/v1/catalog?**", (route) => route.fulfill({json:{items:[{id:1,kind:"boss",pokemon:"勾魂眼",pokemonOriginal:"Sableye",region:"hoenn",location:"Granite Cave",locationNote:"Basement",tier:4,nationalDex:302,hms:["Flash"],valuable:false,source:"Alphapedia",sourceUrl:"https://alpha.pokemmotools.org/alpha-list",syncedAt:"2026-10-03T04:00:00.000Z"}],total:1,page:1,pageSize:20}}));
  await page.goto("/");
  await page.getByRole("button", { name: "刷新资料库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "刷新资料库", exact: true })).toBeVisible();
  await expect(page.getByText("勾魂眼", { exact: true })).toBeVisible();
  await expect(page.getByText("Sableye", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看 Alphapedia 来源", exact: true })).toHaveAttribute("href","https://alpha.pokemmotools.org/alpha-list");
  await page.getByLabel("搜索资料").fill("皮卡丘");
  await page.getByRole("button", { name: "搜索资料", exact: true }).click();
  await expect(page).toHaveURL(/view=catalog/);
});

test("管理员可在推送设置中保存、测试、停用和清除机器人", async ({ page }) => {
  const secret="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=ui-secret-key";
  let state={enabled:true,configured:true,source:"environment",masked:"key=**********t-key",canSaveWebhook:true,configurationError:false,counts:{pending:1,sending:0,sent:2,failed:0,skipped:0},lastSentAt:"2026-10-04T01:00:00.000Z",lastError:null as string|null};
  await page.route("**/api/v1/admin/settings/notifications**",async route=>{
    const method=route.request().method(),url=route.request().url();
    if(method==="PUT"){const body=route.request().postDataJSON();state={...state,enabled:body.enabled,configured:true,source:"database",masked:"key=**********t-key"};}
    if(method==="DELETE")state={...state,source:"environment",configured:true};
    if(method==="POST"&&url.endsWith("/test"))return route.fulfill({json:{ok:true}});
    return route.fulfill({json:state});
  });
  await page.goto("/");
  await page.getByRole("button",{name:"登录 / 注册",exact:true}).click();
  await page.getByLabel("邮箱",{exact:true}).fill("browser-admin@example.com");
  await page.getByLabel("密码",{exact:true}).fill("browser-admin-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("button",{name:"管理后台",exact:true}).click();
  await page.getByRole("button",{name:"推送设置",exact:true}).click();
  await expect(page.getByText("key=**********t-key",{exact:true})).toBeVisible();
  await expect(page.getByText("ui-secret-key")).toHaveCount(0);
  await page.getByLabel("企业微信机器人 Webhook").fill(secret);
  await page.getByRole("button",{name:"保存设置",exact:true}).click();
  await page.getByRole("button",{name:"发送测试消息",exact:true}).click();
  await page.getByLabel("启用企业微信推送").uncheck();
  await page.getByRole("button",{name:"保存设置",exact:true}).click();
  await page.getByRole("button",{name:"清除网页配置",exact:true}).click();
  await expect(page.getByText("ui-secret-key")).toHaveCount(0);
});

test("注册、上报和我的待审记录，登出后保持公开权限", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page
    .getByLabel("邮箱", { exact: true })
    .fill(`player-${Date.now()}@example.com`);
  await page.getByLabel("昵称", { exact: true }).fill("测试训练家");
  await page.getByLabel("密码", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "玩家上报", exact: true }).click();
  await page.getByLabel("宝可梦名称", { exact: true }).fill("皮卡丘");
  await page.getByLabel("地点", { exact: true }).fill("常磐森林");
  await page.getByRole("button", { name: "提交上报", exact: true }).click();
  await expect(
    page.getByText("上报已提交，等待管理员审核。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "我的上报", exact: true }).click();
  await expect(page.getByText("常磐森林", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("article").getByText("待审核", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录 / 注册", exact: true }),
  ).toBeVisible();
});

test("手机页面无横向溢出，网络错误可重试", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "实时情报", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  await page.route("**/api/v1/events?**", (route) => route.abort());
  await page.getByRole("button", { name: "刷新情报", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("连接失败");
  await page.unroute("**/api/v1/events?**");
  await page.getByRole("button", { name: "刷新情报", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("管理员真实审核、编辑、结束、驳回和账号停用，公开历史可追踪", async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const email = `review-player-${Date.now()}@example.com`;
  const headers = { Origin: "http://localhost:5173" };
  const registration = await request.post("/api/v1/auth/register", {
    headers,
    data: {
      email,
      nickname: "待审训练家",
      password: "browser-player-password",
    },
  });
  expect(registration.status()).toBe(201);
  const { csrfToken } = await registration.json();
  const report = {
    kind: "swarm",
    pokemon: "小火龙",
    region: "kanto",
    location: "真新镇测试地点",
    observedAt: new Date().toISOString(),
    note: "浏览器流程真实上报",
  };
  const submitted = await request.post("/api/v1/reports", {
    headers: { ...headers, "X-CSRF-Token": csrfToken },
    data: report,
  });
  expect(submitted.status()).toBe(201);
  const rejected = await request.post("/api/v1/reports", {
    headers: { ...headers, "X-CSRF-Token": csrfToken },
    data: { ...report, pokemon: "杰尼龟", location: "驳回测试地点" },
  });
  expect(rejected.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("browser-admin@example.com");
  await page.getByLabel("密码", { exact: true }).fill("browser-admin-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "管理后台", exact: true }).click();
  const pending = page.locator(".report-card").filter({
    has: page.getByRole("heading", { name: "小火龙", exact: true }),
  });
  await pending.getByRole("button", { name: "通过审核", exact: true }).click();
  await expect(
    page.getByText("审核通过，情报已公开。", { exact: true }),
  ).toBeVisible();
  const denied = page.locator(".report-card").filter({
    has: page.getByRole("heading", { name: "杰尼龟", exact: true }),
  });
  await denied.getByLabel(/驳回理由/).fill("地点信息需要补充");
  await denied.getByRole("button", { name: "驳回", exact: true }).click();
  await expect(page.getByText("报告已驳回。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "实时情报", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "小火龙", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("贡献者：待审训练家")).toBeVisible();
  await page.getByRole("button", { name: "管理后台", exact: true }).click();
  await page.getByRole("button", { name: "情报管理", exact: true }).click();
  const event = page.locator(".admin-event").filter({
    has: page.getByRole("heading", { name: "小火龙", exact: true }),
  });
  await event.getByRole("button", { name: "编辑情报", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("展示截止（北京时间）")
    .fill("2000-01-01T12:00");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("alert").first(),
  ).toContainText("截止时间必须晚于观察时间");
  const validExpiry = new Date(Date.now() + 9 * 3600_000)
    .toISOString()
    .slice(0, 16);
  await page
    .getByRole("dialog")
    .getByLabel("展示截止（北京时间）")
    .fill(validExpiry);
  await page
    .getByRole("dialog")
    .getByLabel("地点", { exact: true })
    .fill("真新镇修正地点");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByText("情报已更新。", { exact: true })).toBeVisible();
  await event.getByRole("button", { name: "标记结束", exact: true }).click();
  await expect(
    page.getByText("情报已标记结束。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "账号管理", exact: true }).click();
  await page.getByLabel("搜索账号").fill(email);
  await page.getByRole("button", { name: "查找账号", exact: true }).click();
  await page
    .locator(".user-card")
    .filter({ hasText: email })
    .getByRole("button", { name: "停用账号", exact: true })
    .click();
  await expect(
    page.getByText("账号已停用，会话已撤销。", { exact: true }),
  ).toBeVisible();
  const revoked = await request.get("/api/v1/reports/mine");
  expect(revoked.status()).toBe(401);
  let releaseUsers: () => void = () => {};
  const delayedUsers = new Promise<void>((resolve) => {
    releaseUsers = resolve;
  });
  let usersStarted: () => void = () => {};
  const usersRequested = new Promise<void>((resolve) => {
    usersStarted = resolve;
  });
  let usersFinished: () => void = () => {};
  const usersFulfilled = new Promise<void>((resolve) => {
    usersFinished = resolve;
  });
  await page.route("**/api/v1/admin/users?**", async (route) => {
    const response = await route.fetch();
    usersStarted();
    await delayedUsers;
    await route.fulfill({ response });
    usersFinished();
  });
  await page.getByRole("button", { name: "刷新队列", exact: true }).click();
  await usersRequested;
  await page.getByRole("button", { name: "待审队列", exact: true }).click();
  releaseUsers();
  await usersFulfilled;
  await expect(page.locator(".user-card")).toHaveCount(0);
  await expect(page.locator(".report-card")).toHaveCount(1);
  await page.unroute("**/api/v1/admin/users?**");
  expect(pageErrors).toEqual([]);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "小火龙", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "历史查询", exact: true }).click();
  const historyCard = page.locator(".event-card").filter({
    has: page.getByRole("heading", { name: "小火龙", exact: true }),
  });
  await expect(historyCard).toContainText("真新镇修正地点");
  await expect(historyCard).toContainText("已结束");
});

test("切换账号时清除私人上报，迟到响应和失败请求不显示旧账号记录", async ({
  page,
  request,
}) => {
  const email = `private-a-${Date.now()}@example.com`;
  const headers = { Origin: "http://localhost:5173" };
  const registration = await request.post("/api/v1/auth/register", {
    headers,
    data: {
      email,
      nickname: "私人账号甲",
      password: "browser-private-password",
    },
  });
  expect(registration.status()).toBe(201);
  const { csrfToken } = await registration.json();
  await request.post("/api/v1/reports", {
    headers: { ...headers, "X-CSRF-Token": csrfToken },
    data: {
      kind: "boss",
      pokemon: "私密测试宝可梦",
      region: "kanto",
      location: "账号甲独有地点",
      observedAt: new Date().toISOString(),
      note: "",
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("browser-private-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "我的上报", exact: true }).click();
  await expect(page.getByText("账号甲独有地点", { exact: true })).toBeVisible();
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/v1/reports/mine?**", async (route) => {
    const response = await route.fetch();
    intercepted();
    await delayed;
    await route.fulfill({ response });
    finish();
  });
  await page.getByRole("button", { name: "刷新记录", exact: true }).click();
  await started;
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page
    .getByLabel("邮箱", { exact: true })
    .fill(`private-b-${Date.now()}@example.com`);
  await page.getByLabel("昵称", { exact: true }).fill("私人账号乙");
  await page
    .getByLabel("密码", { exact: true })
    .fill("browser-private-password");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
  release();
  await finished;
  await page.unroute("**/api/v1/reports/mine?**");
  await page.route("**/api/v1/reports/mine?**", (route) => route.abort());
  await page.getByRole("button", { name: "我的上报", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("连接失败");
  await expect(page.getByText("账号甲独有地点", { exact: true })).toHaveCount(
    0,
  );
});
test("重复点击当前管理标签保留待审队列", async ({ page, request }) => {
  const headers = { Origin: "http://localhost:5173" };
  const login = await request.post("/api/v1/auth/login", {
    headers,
    data: {
      email: "browser-admin@example.com",
      password: "browser-admin-password",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  const submitted = await request.post("/api/v1/reports", {
    headers: { ...headers, "X-CSRF-Token": csrfToken },
    data: {
      kind: "boss",
      pokemon: "同标签回归宝可梦",
      region: "kanto",
      location: "同标签回归地点",
      observedAt: new Date().toISOString(),
    },
  });
  expect(submitted.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("browser-admin@example.com");
  await page.getByLabel("密码", { exact: true }).fill("browser-admin-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "管理后台", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "同标签回归宝可梦", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "待审队列", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "同标签回归宝可梦", exact: true }),
  ).toBeVisible();
});

test("审核写入等待期间切换标签不会安装错误形状的旧队列", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const headers = { Origin: "http://localhost:5173" };
  const login = await request.post("/api/v1/auth/login", {
    headers,
    data: {
      email: "browser-admin@example.com",
      password: "browser-admin-password",
    },
  });
  expect(login.status()).toBe(200);
  const { csrfToken } = await login.json();
  const submitted = await request.post("/api/v1/reports", {
    headers: { ...headers, "X-CSRF-Token": csrfToken },
    data: {
      kind: "boss",
      pokemon: "写入回归宝可梦",
      region: "kanto",
      location: "写入回归地点",
      observedAt: new Date().toISOString(),
    },
  });
  expect(submitted.status()).toBe(201);
  const report = await submitted.json();
  await page.goto("/");
  await page.getByRole("button", { name: "登录 / 注册", exact: true }).click();
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("browser-admin@example.com");
  await page.getByLabel("密码", { exact: true }).fill("browser-admin-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "管理后台", exact: true }).click();
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let begin: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route(
    `**/api/v1/admin/reports/${report.id}/review`,
    async (route) => {
      const response = await route.fetch();
      begin();
      await delayed;
      await route.fulfill({ response });
      finish();
    },
  );
  await page
    .locator(".report-card")
    .filter({
      has: page.getByRole("heading", { name: "写入回归宝可梦", exact: true }),
    })
    .getByRole("button", { name: "通过审核", exact: true })
    .click();
  await started;
  const eventTab = page.getByRole("button", { name: "情报管理", exact: true });
  const blocked = await eventTab.isDisabled();
  await eventTab.evaluate((button) => (button as HTMLButtonElement).click());
  release();
  await finished;
  await page.unroute(`**/api/v1/admin/reports/${report.id}/review`);
  expect(blocked).toBe(true);
  await expect(page.locator(".panel-toolbar .kind-tabs .active")).toHaveText(
    "待审队列",
  );
  await expect(
    page.getByText("审核通过，情报已公开。", { exact: true }),
  ).toBeVisible();
  await expect(eventTab).toBeEnabled();
  expect(errors).toEqual([]);
  await eventTab.click();
  await expect(
    page.getByRole("heading", { name: "写入回归宝可梦", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
