-- 007_rbac_taxonomy_overhaul.sql
-- Full RBAC, Taxonomy, Team, and Employee Provisioning overhaul per spec

PRAGMA foreign_keys = OFF;

-- ─── 1. ACCOUNTS ────────────────────────────────────────────────────────────
-- Already exists in schema.sql; ensure status column is correct
-- (no-op if already present)

-- ─── 2. TICKET CATEGORIES — add new columns ─────────────────────────────────
ALTER TABLE ticket_categories ADD COLUMN is_global INTEGER DEFAULT 1;
ALTER TABLE ticket_categories ADD COLUMN default_sla_id INTEGER REFERENCES sla_rules(id) ON DELETE SET NULL;
ALTER TABLE ticket_categories ADD COLUMN default_priority TEXT DEFAULT 'medium' CHECK(default_priority IN ('low','medium','high','urgent'));
ALTER TABLE ticket_categories ADD COLUMN default_team_id INTEGER;  -- FK added after teams table exists
ALTER TABLE ticket_categories ADD COLUMN status TEXT DEFAULT 'active' CHECK(status IN ('active','draft','archived'));

-- ─── 3. TICKET SUBCATEGORIES — add override columns ─────────────────────────
ALTER TABLE ticket_subcategories ADD COLUMN default_sla_id INTEGER REFERENCES sla_rules(id) ON DELETE SET NULL;
ALTER TABLE ticket_subcategories ADD COLUMN default_priority TEXT CHECK(default_priority IN ('low','medium','high','urgent'));
ALTER TABLE ticket_subcategories ADD COLUMN default_team_id INTEGER;
ALTER TABLE ticket_subcategories ADD COLUMN status TEXT DEFAULT 'active' CHECK(status IN ('active','draft','archived'));

-- ─── 4. ACCOUNT ↔ CATEGORY ACCESS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_category_access (
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES ticket_categories(id) ON DELETE CASCADE,
  enabled     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, category_id)
);

-- ─── 5. ACCOUNT ↔ SUBCATEGORY ACCESS (optional override) ────────────────────
CREATE TABLE IF NOT EXISTS account_subcategory_access (
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subcategory_id INTEGER NOT NULL REFERENCES ticket_subcategories(id) ON DELETE CASCADE,
  enabled        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, subcategory_id)
);

-- ─── 6. TEAMS (replace existing teams table) ────────────────────────────────
DROP TABLE IF EXISTS team_permissions;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;

CREATE TABLE teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,  -- NULL = global
  status     TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── 7. TEAM ↔ CATEGORY ASSIGNMENTS (default routing) ───────────────────────
CREATE TABLE IF NOT EXISTS team_category_assignments (
  team_id        INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES ticket_categories(id) ON DELETE CASCADE,
  subcategory_id INTEGER REFERENCES ticket_subcategories(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, category_id, subcategory_id)
);

-- ─── 8. ROLES ────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;

CREATE TABLE roles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  scope      TEXT DEFAULT 'account' CHECK(scope IN ('global','account','team')),
  is_system  INTEGER DEFAULT 0,
  status     TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── 9. PERMISSIONS ──────────────────────────────────────────────────────────
DROP TABLE IF EXISTS permissions;

CREATE TABLE permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,   -- e.g. ticket.view, category.delete
  module      TEXT NOT NULL,          -- e.g. tickets, taxonomy, accounts, users, reports
  description TEXT
);

-- ─── 10. ROLE ↔ PERMISSIONS ──────────────────────────────────────────────────
CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect        TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  PRIMARY KEY (role_id, permission_id)
);

-- ─── 11. TEAM ↔ ROLES ────────────────────────────────────────────────────────
CREATE TABLE team_roles (
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  is_default INTEGER DEFAULT 0,
  PRIMARY KEY (team_id, role_id)
);

-- ─── 12. EMPLOYEE USERS ──────────────────────────────────────────────────────
DROP TABLE IF EXISTS employee_profiles;
DROP TABLE IF EXISTS employee_invites;

CREATE TABLE employee_users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  team_id        INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  role_id        INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  full_name      TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  phone          TEXT,
  password_hash  TEXT,
  invite_token   TEXT UNIQUE,
  invite_expires DATETIME,
  employment_status TEXT DEFAULT 'active' CHECK(employment_status IN ('active','suspended','deactivated','pending_invite')),
  last_login_at  DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── 13. EMPLOYEE PERMISSION OVERRIDES ───────────────────────────────────────
CREATE TABLE employee_permission_overrides (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employee_users(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect        TEXT NOT NULL CHECK(effect IN ('allow','deny')),
  reason        TEXT NOT NULL,
  granted_by    INTEGER NOT NULL REFERENCES employee_users(id),
  expires_at    DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, permission_id)
);

-- ─── 14. AUDIT LOG ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER NOT NULL,
  actor_type  TEXT NOT NULL CHECK(actor_type IN ('employee','admin','system')),
  action      TEXT NOT NULL,   -- e.g. role.assigned, category.archived, employee.suspended
  target_type TEXT,            -- e.g. employee, role, category, team
  target_id   INTEGER,
  old_value   TEXT,            -- JSON snapshot
  new_value   TEXT,            -- JSON snapshot
  ip_hash     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── 15. SEED PERMISSIONS ────────────────────────────────────────────────────
INSERT OR IGNORE INTO permissions (code, module, description) VALUES
  ('ticket.view',        'tickets',  'View tickets'),
  ('ticket.assign',      'tickets',  'Assign tickets to agents'),
  ('ticket.reply',       'tickets',  'Reply to tickets'),
  ('ticket.resolve',     'tickets',  'Mark tickets as resolved'),
  ('ticket.reopen',      'tickets',  'Reopen closed tickets'),
  ('ticket.delete',      'tickets',  'Delete tickets'),
  ('category.create',    'taxonomy', 'Create ticket categories'),
  ('category.edit',      'taxonomy', 'Edit ticket categories'),
  ('category.archive',   'taxonomy', 'Archive ticket categories'),
  ('category.delete',    'taxonomy', 'Delete ticket categories'),
  ('account.view',       'accounts', 'View account settings'),
  ('account.manage',     'accounts', 'Manage account settings'),
  ('user.create',        'users',    'Create users'),
  ('user.deactivate',    'users',    'Deactivate users'),
  ('user.manage_roles',  'users',    'Manage user roles'),
  ('report.view',        'reports',  'View analytics reports'),
  ('report.export',      'reports',  'Export analytics reports');

-- ─── 16. SEED DEFAULT ROLES ──────────────────────────────────────────────────
INSERT OR IGNORE INTO roles (name, scope, is_system, status) VALUES
  ('Super Admin', 'global',  1, 'active'),
  ('Admin',       'account', 1, 'active'),
  ('Agent',       'team',    1, 'active'),
  ('Viewer',      'team',    1, 'active');

-- Agent gets ticket.view + ticket.reply (minimum for routing)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r, permissions p
WHERE r.name = 'Agent' AND p.code IN ('ticket.view','ticket.reply','ticket.resolve','ticket.reopen');

-- Admin gets all permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r, permissions p
WHERE r.name = 'Admin';

-- Super Admin gets all permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'allow'
FROM roles r, permissions p
WHERE r.name = 'Super Admin';

PRAGMA foreign_keys = ON;
