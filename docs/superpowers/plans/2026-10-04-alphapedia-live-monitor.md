# Alphapedia Live Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Poll Alphapedia every 30 seconds, publish each new valid Alpha as an external live event, and enqueue one Enterprise WeChat notification.

**Architecture:** A focused monitor owns the upstream session, token, polling lifecycle, parser, and persisted health state. A transactional external publisher owns idempotent report/event/outbox writes. The existing admin notification settings endpoint exposes sanitized monitor status to the current settings UI.

**Tech Stack:** Node.js 24, Fastify 5, SQLite, native Fetch API, React 19, TypeScript, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-alphapedia-live-monitor-design.md`

## Global Constraints

- Poll interval defaults to 30 seconds and accepts only 15–300 seconds.
- Tokens, cookies, remote response bodies, and Webhook secrets never enter logs, APIs, audits, or errors.
- Only complete events with a valid name, supported region, location, timestamp, and Alphapedia source URL are published.
- Event validity is exactly 75 minutes from the observed timestamp.
- One upstream event produces at most one report, one event, and one notification outbox row across restarts.
- Network and parsing failures never remove the last successful event or stop the server.

---

### Task 1: Parser and Idempotent External Publisher

**Files:**
- Create: `server/alpha-monitor.mjs`
- Modify: `server/db.mjs`
- Modify: `server/reports.mjs`
- Create: `tests/alpha-monitor.test.mjs`

**Interfaces:**
- Produces: `parseLandingStatus(payload): {sourceEventId,pokemon,region,location,observedAt,expiresAt,sourceUrl}`.
- Produces: `publishExternalEvent({db,notifications,event,now}): {published:boolean,eventId?:number}`.

- [x] Write failing tests for complete parsing, malformed payload rejection, expired first state, active publication, duplicate publication, and transaction rollback.
- [x] Run `node --test tests/alpha-monitor.test.mjs`; expect missing module failure.
- [x] Add `external_monitor_state` and implement strict parsing without executing remote HTML.
- [x] Implement transactional direct publication with `reports(source='external')`, active event, audit, and outbox enqueue.
- [x] Re-run the focused test; expect PASS.

### Task 2: Polling Lifecycle and Server Wiring

**Files:**
- Modify: `server/alpha-monitor.mjs`
- Modify: `server/app.mjs`
- Modify: `server/main.mjs`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `tests/alpha-monitor.test.mjs`

**Interfaces:**
- Produces: `createAlphaMonitor({db,notifications,fetchImpl,now,enabled,intervalMs,baseUrl,autoStart})` with `start`, `runOnce`, `close`, `status`.
- Produces: `app.alphaMonitor` and `GET /api/v1/admin/monitor`.

- [x] Write failing tests for cookie/token flow, duplicate polls, token refresh after 403, failure recovery, concurrent calls, close abort, and sanitized status.
- [x] Run focused tests; expect missing lifecycle behavior.
- [x] Implement session establishment, cookie handling, token extraction, status fetch, serialized runs, persisted health, and safe shutdown.
- [x] Wire `ALPHA_MONITOR_ENABLED` and `ALPHA_MONITOR_INTERVAL_SECONDS`, require external source enablement, and register the admin status route.
- [x] Run `node --test tests/alpha-monitor.test.mjs tests/wecom.test.mjs`; expect PASS.

### Task 3: Admin Status UI, Documentation, and Verification

**Files:**
- Modify: `client/notification-settings.tsx`
- Modify: `client/styles.css`
- Modify: `tests/ui.spec.ts`
- Modify: `README.md`
- Modify: `docs/api.md`
- Modify: `docs/VERIFICATION.md`

**Interfaces:**
- Consumes: `GET /api/v1/admin/monitor`.
- Produces: monitor health card inside the administrator push settings page.

- [x] Write a failing browser assertion for enabled state, 30-second cadence, last check, last event, and sanitized error.
- [x] Run `npx playwright test --grep "头目实时监控"`; expect missing UI failure.
- [x] Add the monitor status card with loading and unavailable states.
- [x] Document configuration, effective-time rules, upstream dependency, and operational checks.
- [x] Run `npm test`, `npm run build`, `npm run test:production`, `npm run test:ui`, and `git diff --check`; expect all PASS.
- [x] Run one real read-only Alphapedia parse and confirm a complete structured event without publishing it.
