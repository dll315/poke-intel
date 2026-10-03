# Chinese Names and WeCom Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display searchable Chinese Pokémon names and let administrators securely configure and test an Enterprise WeChat robot from the web UI.

**Architecture:** Extend the transactional Alphapedia catalog refresh with its Chinese species map and keep original names for provenance. Add an AES-256-GCM settings vault backed by SQLite, then make the existing notification worker resolve its active webhook dynamically. Expose admin-only settings endpoints and a focused settings tab without ever returning the complete webhook.

**Tech Stack:** Node.js 24, Fastify 5, SQLite, Web Crypto/`node:crypto`, React 19, TypeScript, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-chinese-names-wecom-settings-design.md`

## Global Constraints

- Full webhook values, encryption keys, ciphertext, and provider response bodies must never appear in read APIs, audit records, logs, or user-facing errors.
- Only administrators may read or mutate notification settings.
- The existing strict WeCom URL validator remains the single validation boundary.
- Database configuration takes precedence over `WECOM_WEBHOOK_URL`; clearing it restores the environment fallback.
- Enabling notifications does not enqueue historical events.
- Existing notification retry, deduplication, pacing, and six-attempt limit remain intact.
- Catalog synchronization is atomic and retains the last successful data when any upstream request fails.

---

### Task 1: Chinese Pokémon Names

**Files:**
- Modify: `server/db.mjs`
- Modify: `server/catalog.mjs`
- Modify: `server/events.mjs`
- Modify: `server/notifications.mjs`
- Modify: `client/types.ts`
- Modify: `client/catalog.tsx`
- Modify: `tests/api.test.mjs`
- Modify: `tests/wecom.test.mjs`
- Modify: `tests/ui.spec.ts`

**Interfaces:**
- Produces: `pokemon_names(english_name, chinese_name, synced_at)` and catalog fields `pokemon`, `pokemonOriginal`.
- Produces: `translatePokemon(db, value): string`, returning the cached Chinese name or the input unchanged.

- [ ] **Step 1: Write failing catalog and event translation tests**

Add assertions that the sync fetches `/static/translations/zh/pokemon-species-zh.json`, returns `pokemon: "勾魂眼"` with `pokemonOriginal: "Sableye"`, finds the row with either `q=勾魂眼` or `q=Sableye`, translates English event output and WeCom messages, and leaves unknown or already-Chinese names unchanged.

- [ ] **Step 2: Verify the focused tests fail**

Run: `node --test --test-name-pattern="Chinese|中文|Alphapedia catalog" tests/api.test.mjs tests/wecom.test.mjs`

Expected: FAIL because the translation endpoint is not fetched and `pokemonOriginal`/`translatePokemon` do not exist.

- [ ] **Step 3: Add transactional translation storage and lookup**

Create `pokemon_names` with case-insensitive English-name uniqueness. Fetch the Chinese JSON as the fourth catalog request, replace names in the same transaction as `external_catalog`, add `pokemon_original` and `pokemon_zh` columns, and implement `translatePokemon(db,value)` with exact and case-insensitive lookup.

- [ ] **Step 4: Apply translations at API and notification boundaries**

Return Chinese display names while preserving originals; extend search SQL to both columns. Translate event serialization and notification message construction without rewriting stored reports or events.

- [ ] **Step 5: Update the catalog UI and browser test**

Render the Chinese name as the card heading and the English original below it. Update the mocked catalog payload and assert both names are visible and Chinese search changes the request.

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test tests/api.test.mjs tests/wecom.test.mjs && npx playwright test --grep "资料库展示"`

Expected: PASS.

Commit: `git commit -m "feat: add Chinese Pokemon names"`

### Task 2: Encrypted Settings Vault

**Files:**
- Create: `server/settings.mjs`
- Modify: `server/db.mjs`
- Create: `tests/settings.test.mjs`

**Interfaces:**
- Produces: `parseSettingsKey(value): Buffer | null`.
- Produces: `createSettings({db,encryptionKey,environmentWebhook,now})` with `getNotificationConfig()`, `getNotificationStatus()`, `saveNotificationConfig(input,actorId)`, and `clearNotificationWebhook(actorId)`.

- [ ] **Step 1: Write failing encryption and precedence tests**

Test AES-GCM round-trip through the public settings service, assert SQLite text does not contain the webhook key, assert read status contains only `configured`, `enabled`, `source`, and a masked suffix, and cover database-over-environment precedence, disable, clear, missing key, invalid key, and corrupted ciphertext.

- [ ] **Step 2: Verify settings tests fail**

Run: `node --test tests/settings.test.mjs`

Expected: FAIL with missing `server/settings.mjs`.

- [ ] **Step 3: Implement the settings table and vault**

Create `app_settings(key PRIMARY KEY,value,updated_at,updated_by)` with a foreign key to users for `updated_by`. Use AES-256-GCM with a random 12-byte IV and versioned Base64 payload `v1.iv.tag.ciphertext`. Accept exactly 32 decoded bytes from 64 hex characters or Base64.

- [ ] **Step 4: Implement notification setting semantics and audit**

Store enabled state separately from encrypted webhook. Validate before encrypting. Audit only `{enabled,configured,source,masked}`. Treat decryption failure as a sanitized configuration error and never fall through to an unrelated stored value.

- [ ] **Step 5: Run settings tests and commit**

Run: `node --test tests/settings.test.mjs`

Expected: PASS.

Commit: `git commit -m "feat: encrypt persisted notification settings"`

### Task 3: Dynamic Notification Configuration and Admin API

**Files:**
- Modify: `server/notifications.mjs`
- Modify: `server/admin.mjs`
- Modify: `server/app.mjs`
- Modify: `server/main.mjs`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `tests/wecom.test.mjs`
- Modify: `tests/settings.test.mjs`

**Interfaces:**
- Consumes: `settings.getNotificationConfig()` and settings mutations from Task 2.
- Produces: `notifications.sendTest()` and the four admin routes defined in the spec.

- [ ] **Step 1: Write failing dynamic configuration API tests**

Test admin-only GET/PUT/DELETE/POST routes, Origin and CSRF enforcement, save-without-restart, disable-without-delete, environment fallback after delete, fixed safe test payload, sanitized provider failures, and no historical enqueue when enabling.

- [ ] **Step 2: Verify focused tests fail**

Run: `node --test tests/settings.test.mjs tests/wecom.test.mjs`

Expected: FAIL with 404 routes and immutable notification configuration.

- [ ] **Step 3: Resolve active configuration per notification operation**

Replace the closure boolean and URL with `settings.getNotificationConfig()` calls in `enqueueEvent`, `sendNext`, `start`, and `status`. Keep claimed jobs queued when temporarily disabled. Implement `sendTest()` through the same validation, timeout, redirect, and response-sanitizing rules without adding an outbox event.

- [ ] **Step 4: Add admin routes and environment wiring**

Register the four routes under `/api/v1/admin/settings/notifications`. Pass `SETTINGS_ENCRYPTION_KEY` into the vault and document a generation command using `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Add the variable to Compose without a default secret.

- [ ] **Step 5: Run backend tests and commit**

Run: `npm test`

Expected: all Node tests PASS.

Commit: `git commit -m "feat: configure WeCom notifications at runtime"`

### Task 4: Administrator Push Settings UI

**Files:**
- Create: `client/notification-settings.tsx`
- Modify: `client/admin.tsx`
- Modify: `client/types.ts`
- Modify: `client/styles.css`
- Modify: `tests/ui.spec.ts`

**Interfaces:**
- Consumes: admin notification settings endpoints from Task 3.
- Produces: `NotificationSettings({onError,onSuccess})` admin panel.

- [ ] **Step 1: Write the failing browser workflow**

Mock or exercise the settings endpoints and assert an administrator can open “推送设置”, sees only a masked value, enters a new webhook in a password field, saves it, sends a test message, disables it, and clears it. Assert the complete existing webhook never appears in the DOM or GET response.

- [ ] **Step 2: Verify the browser test fails**

Run: `npx playwright test --grep "推送设置"`

Expected: FAIL because the tab and form do not exist.

- [ ] **Step 3: Build the focused settings component**

Implement loading, save, test, disable, and clear actions with busy states. Never populate the password input from GET data. Show configuration source, masked suffix, counts, recent send time, recent sanitized error, and the missing-encryption-key instruction.

- [ ] **Step 4: Integrate the fourth admin tab and responsive styles**

Keep settings state outside the report/event/user list union. When the tab is selected render only `NotificationSettings`; preserve current mutation guards and mobile single-column layout.

- [ ] **Step 5: Run UI tests and commit**

Run: `npm run test:ui`

Expected: all Playwright tests PASS.

Commit: `git commit -m "feat: add WeCom push settings UI"`

### Task 5: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/api.md`
- Modify: `docs/VERIFICATION.md`

**Interfaces:**
- Consumes: final environment variables and API behavior from Tasks 1–4.
- Produces: deployment and recovery instructions for the Ubuntu server.

- [ ] **Step 1: Document setup, rotation, backup, and recovery**

Document `SETTINGS_ENCRYPTION_KEY`, explain that losing or changing it makes the stored Webhook unreadable, describe environment fallback, and list the admin settings workflow. Document Chinese-name provenance and fallback behavior.

- [ ] **Step 2: Run formatting and diff checks**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 3: Run the full verification suite**

Run: `npm test && npm run build && npm run test:ui`

Expected: all Node tests, TypeScript/Vite build, and Playwright tests PASS.

- [ ] **Step 4: Verify against the live Alphapedia data**

Run a one-off in-memory catalog refresh and assert the returned catalog contains a Chinese `pokemon`, an English `pokemonOriginal`, and more than zero rows without writing credentials.

- [ ] **Step 5: Commit documentation**

Commit: `git commit -m "docs: explain Chinese names and secure push settings"`
