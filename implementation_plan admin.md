# Admin Panel Overhaul: Bug Fixes, Missing Routes, User Management & Moderation System

## Problem Summary

The admin panel has two critical architectural issues and many missing features:

1. **Navigation leak**: `initAuthLayout()` in [app.js](file:///D:/My%20Applications/Midnigth%20stories/public/js/app.js#L362-L440) **overwrites the admin header** with public nav links (Browse, Share Story, Find User, Chats) every time it runs. The admin page already defines its own correct header (lines 16-35 of admin.html), but `app.js` replaces it.

2. **Missing backend routes**: The frontend [admin.js](file:///D:/My%20Applications/Midnigth%20stories/public/js/admin.js) calls these admin API endpoints, but most are **not implemented** in [worker.js](file:///D:/My%20Applications/Midnigth%20stories/src/worker.js):
   - `GET /api/admin/categories` → ❌ Missing
   - `POST /api/admin/categories` → ❌ Missing
   - `DELETE /api/admin/categories/:id` → ❌ Missing
   - `GET /api/admin/bans` → ❌ Missing
   - `POST /api/admin/ban` → ❌ Missing
   - `DELETE /api/admin/bans/:id` → ❌ Missing
   - `GET /api/admin/settings` → ❌ Missing
   - `PUT /api/admin/settings` → ❌ Missing
   - `GET /api/admin/reports` → ❌ Missing
   - `POST /api/admin/reports/:id/resolve` → ❌ Missing
   - `GET /api/admin/audit-log` → ❌ Missing
   - `POST /api/admin/mfa-setup` → ❌ Missing
   - `POST /api/admin/mfa-enable` → ❌ Missing
   - `POST /api/admin/mfa-verify` → ❌ Missing
   - `GET /api/admin/stats` → ✅ Exists but **incomplete** (missing `approvedStories`, `rejectedStories`, `openReports`, `pendingComments`, `bannedIPs`)

3. **No User Management panel**: No user directory, status management, relationship overrides, or chat controls in admin.

4. **No Warning/Enforcement system**: No database tables or API for warnings, suspensions, or automated enforcement.

---

## Proposed Changes

### Phase 1: Bug Fixes (Critical)

---

#### [MODIFY] [app.js](file:///D:/My%20Applications/Midnigth%20stories/public/js/app.js)

**Fix navigation leak**: Add a guard in `initAuthLayout()` to skip header overwrite when `data-page="admin"` is set on the `<html>` element. This preserves the admin's custom header.

```diff
 function initAuthLayout() {
+  // Skip on admin page — admin has its own isolated header
+  if (document.documentElement.getAttribute('data-page') === 'admin') return;
+
   const header = document.querySelector('header.header');
   if (!header) return;
```

Also skip `initNotifications()` on admin pages to prevent user notification polling from interfering.

---

### Phase 2: Missing Admin Backend Routes

---

#### [MODIFY] [worker.js](file:///D:/My%20Applications/Midnigth%20stories/src/worker.js)

Add **all missing admin API endpoints** after the existing `POST /api/admin/moderate` route:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/admin/stats` | Fix to return all 9 stats the frontend expects |
| `GET /api/admin/categories` | List categories with story counts |
| `POST /api/admin/categories` | Create a new category |
| `DELETE /api/admin/categories/:id` | Delete a category |
| `GET /api/admin/bans` | List all banned identifiers |
| `POST /api/admin/ban` | Add an IP ban |
| `DELETE /api/admin/bans/:id` | Remove a ban |
| `GET /api/admin/settings` | Load all platform settings |
| `PUT /api/admin/settings` | Save platform settings |
| `GET /api/admin/reports` | List reports (filtered by resolved status) |
| `POST /api/admin/reports/:id/resolve` | Resolve a report |
| `GET /api/admin/audit-log` | Fetch moderation log with admin usernames |
| `POST /api/admin/mfa-setup` | Generate MFA secret and QR code |
| `POST /api/admin/mfa-verify` | Verify MFA code during login |
| `POST /api/admin/mfa-enable` | Enable MFA after verifying initial code |

---

### Phase 3: User Management & Moderation System

---

#### [MODIFY] [schema.sql](file:///D:/My%20Applications/Midnigth%20stories/schema.sql)

Add new tables for warnings and user status:

- **`user_warnings`** — Stores admin-issued warnings with level, reason, and template
- **`users` ALTER** — Add `account_status` column (`active`, `suspended`, `banned`, `shadowbanned`) and `dm_permission` column (`full`, `text_only`, `suspended`)

#### [MODIFY] [worker.js](file:///D:/My%20Applications/Midnigth%20stories/src/worker.js)

Add new admin endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/admin/users` | Enhanced: returns status, dm_permission, follows/blocks counts |
| `GET /api/admin/users/:id/relationships` | View user's follows and blocks ledger |
| `POST /api/admin/users/:id/status` | Change user account status (active/suspended/banned/shadowbanned) |
| `POST /api/admin/users/:id/force-unfollow` | Admin force-unfollow between two users |
| `POST /api/admin/users/:id/force-unblock` | Admin force-unblock between two users |
| `POST /api/admin/users/:id/reset-connections` | Nuke all follows/blocks for bot accounts |
| `PUT /api/admin/users/:id/dm-permission` | Set DM permission level |
| `POST /api/admin/users/:id/warn` | Issue a warning to a user |
| `GET /api/admin/users/:id/warnings` | View user's warning history |
| `POST /api/admin/reports/:id/enforce` | One-click enforcement from report queue (suspend/ban/IP-ban) |

#### [MODIFY] [admin.html](file:///D:/My%20Applications/Midnigth%20stories/public/admin.html)

Add new sidebar sections and panels:
- **Users** panel with directory table, status badges, and quick-action drawer
- **User Detail** modal/drawer with relationship ledger, chat controls, and warning history
- Enhanced **Reports** panel with enforcement actions and reply-to-reporter

#### [MODIFY] [admin.js](file:///D:/My%20Applications/Midnigth%20stories/public/js/admin.js)

Add JavaScript functions for:
- User directory loading, filtering, status changes
- Relationship ledger display and force actions
- Warning system UI (templates, issue, history)
- Report enforcement workflow
- Enhanced report resolution with reply

---

### Phase 4: Database Migrations (Run on D1)

SQL migration to add new columns and tables to the live database:

```sql
-- Add account_status and dm_permission to users
ALTER TABLE users ADD COLUMN account_status TEXT DEFAULT 'active'
  CHECK(account_status IN ('active','suspended','banned','shadowbanned'));
ALTER TABLE users ADD COLUMN dm_permission TEXT DEFAULT 'full'
  CHECK(dm_permission IN ('full','text_only','suspended'));

-- User warnings table
CREATE TABLE IF NOT EXISTS user_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  level TEXT NOT NULL CHECK(level IN ('first_warning','second_warning','final_notice')),
  template TEXT NOT NULL,
  reason TEXT NOT NULL,
  rule_broken TEXT,
  penalties TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Enhance reports table
ALTER TABLE reports ADD COLUMN reporter_id INTEGER REFERENCES users(id);
ALTER TABLE reports ADD COLUMN admin_reply TEXT;
ALTER TABLE reports ADD COLUMN resolved_by INTEGER REFERENCES admin_users(id);
ALTER TABLE reports ADD COLUMN resolved_at DATETIME;
ALTER TABLE reports ADD COLUMN enforcement_action TEXT;
```

---

## Verification Plan

### Manual Verification
1. Login to admin panel → confirm admin header has no public nav links
2. Navigate to Categories → confirm list loads, can add/delete
3. Navigate to Bans → confirm list loads, can add/remove
4. Navigate to Settings → confirm settings load and save
5. Navigate to Reports → confirm reports load and resolve
6. Navigate to Audit Log → confirm log entries display
7. Navigate to Users → confirm user directory with status management
8. Test warning flow: select user → issue warning → verify notification appears for user
9. Test enforcement: from report → ban user → verify account status changes

### Automated Tests
- Deploy with `npx wrangler deploy`
- Verify all admin endpoints return 200 with valid admin token
- Verify all admin endpoints return 401 without token

> [!IMPORTANT]
> This is a large change spanning ~4 files and ~1500+ lines of new code. The implementation will be done in the ordered phases above. Phase 1 (nav fix) and Phase 2 (missing routes) are **critical blockers** — the admin panel is completely broken without them.

> [!WARNING]
> The database migration SQL must be run on the live D1 database via `wrangler d1 execute` before deploying the new code that references the new columns/tables.
