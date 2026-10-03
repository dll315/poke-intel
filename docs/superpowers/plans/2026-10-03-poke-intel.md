# Poke 情报站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a deployable Chinese public PokeMMO reporting website with registration, moderation, history and Ubuntu deployment artifacts.

**Architecture:** React TypeScript client talks to a same-origin Fastify API. Node 24 SQLite persists accounts, sessions, reports, events and audit entries. Nginx and Docker Compose target the user's Ubuntu server.

**Tech Stack:** Node 24, Fastify, React, Vite, TypeScript, SQLite, Playwright.

**Spec:** ../specs/2026-10-03-poke-intel-design.md

## Global Constraints

- Chinese UI; display Asia/Shanghai timestamps, persist UTC timestamps.
- Public browsing, email/password accounts, pending reports, admin-only moderation.
- SQLite parameterized queries and transactions; session cookie plus CSRF/Origin checks.
- No default admin password, no automatic external scraping, no unlabeled examples.
- Ubuntu 4-core 4-GB server and existing filed domain; future mini-program shares /api/v1.
- Persist database; expiration and 15-minute same-location deduplication; traceable sources.

## Task 1: API, data and security

**Files:** package.json, server/{app,db,auth,reports,events,admin,validation}.mjs, tests/api.test.mjs.

**Interfaces:** buildApp({dbPath,origin,now}) returns Fastify application. createUser(db,{email,nickname,password,role}) creates hashed account. API contract in docs/api.md defines all client-facing fields. Responses use {error,fields?} for failures. Lists use {items,total,page,pageSize}; auth uses {user,csrfToken}; event fields id,kind,pokemon,region,location,observedAt,expiresAt,lastConfirmedAt,status,source,sourceUrl,note,contributors. Admin reviews POST /admin/reports/:id/review with {action:'approve'|'reject',reason?,expiresAt?}; event PATCH; user PATCH {disabled}.

- [ ] Write real integration tests using app.inject and temporary SQLite. Assert anonymous POST /reports returns 401; register/login obtains session; pending report absent from public events; normal user review returns 403; approve exposes event; duplicates merge but distinct locations don't; expiry goes to history; disable invalidates session; bad Origin/CSRF fail; invalid fields and limits fail; historical dates use +08:00.

```js
const res = await app.inject({method:'POST',url:'/api/v1/reports',payload:{}});
assert.equal(res.statusCode,401);
```

- [ ] Run `node --test tests/api.test.mjs`, observe missing routes/behavior fail.
- [ ] Implement modules, SQLite schema, validation and transactional state changes until assertions pass. Add bounded login/register/report limits and password hashing.
- [ ] Run tests and commit task.

## Task 2: Responsive webpage

**Files:** index.html, vite.config.ts, tsconfig.json, client/{main,App,api,types}.tsx/ts, client/styles.css, public/favicon.svg, tests/ui.spec.ts.

**Interfaces:** Consume Task 1 JSON contract above; same-origin credentials and CSRF header for writes; Vite proxy /api to localhost:3001. No database or server module edits in this task.

- [ ] Write browser tests for empty public view, registration/login, pending report display, admin approval, public event, history, sign-out and mobile overflow. Register through real API; create admin via CLI test fixture.

```ts
await page.goto('/');
await expect(page.getByRole('heading',{name:'实时情报'})).toBeVisible();
```

- [ ] Run browser suite before authoring UI and verify failure from missing expected experience.
- [ ] Implement Chinese responsive homepage, history filters/pagination, authentication dialog, reporting form/my reports, administrator reports/events/users and clear network/error/empty states. Poll every 60 seconds and show last successful refresh time. Escape all user content via React.
- [ ] Run TypeScript check, build and browser tests. Commit task.

## Task 3: Deployment and whole-system verification

**Files:** Dockerfile, compose.yaml, deploy/nginx.conf, deploy/nginx-https.conf, scripts/{admin,backup,restore}.mjs, .env.example, README.md.

**Interfaces:** DB_PATH default data/poke.db, ORIGIN default http://localhost:3001 for development; production requires explicit https origin. Server serves built client with SPA fallback. Admin command prompts password securely; no password arguments/logs.

- [ ] Add persistence and admin initialization tests; run failing tests before CLI implementation.
- [ ] Write Node 24 container, persistent /app/data volume, loopback proxy ports, HTTPS deployment instructions and portable SQLite backup/restore using SQLite backup/VACUUM INTO. Restore requires stopped application and explicit confirmation; refuses overwrite without flag.
- [ ] Run `npm test`, `npm run build`, full Playwright suite; independently review security and spec coverage, fix observed issues with regression tests.
- [ ] Package deployable source excluding secrets/database/node_modules; commit verified changes. Report local preview and deployment prerequisites, never claim remote deployment without server access.

## Decisions

Use native Node 24 SQLite to avoid native addon installation on Windows/Ubuntu. Document Node's current SQLite maturity. No external source adapter enabled without permission. First MVP uses plain named Pokemon entries; full national dex validation belongs to a later catalog feature.
