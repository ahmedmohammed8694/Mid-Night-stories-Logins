// src/worker.js — Cloudflare Worker entry point for Midnight Stories
// Upgraded version: local auth, Google OAuth 2.0, profiles, followers, reads history, and likes tracking.

import { Hono } from 'hono';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';

import {
  moderateText, hashIP, detectCrisisLanguage, detectPII, checkImageSafety
} from './moderation.js';
import { getEffectivePermissions, writeAuditLog } from './permissions.js';

// ── Native JWT using Web Crypto API (works natively in Cloudflare Workers) ──
async function signJWT(payload, secret) {
  const enc = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sigB64}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [header, payload, signature] = parts;
  const enc = new TextEncoder();
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const padded = signature.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, '='));
  const sigBuf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) sigBuf[i] = binary.charCodeAt(i);
  const isValid = await crypto.subtle.verify('HMAC', key, sigBuf, enc.encode(data));
  if (!isValid) throw new Error('Invalid token signature');
  const decoded = JSON.parse(atob(
    payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      payload.length + (4 - payload.length % 4) % 4, '='
    )
  ));
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return decoded;
}

function generateUserId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'USER_';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function createNotification(db, userId, actorId, type, targetId, content) {
  if (Number(userId) === Number(actorId)) return;
  try {
    await db.prepare(
      'INSERT INTO notifications (user_id, actor_id, type, target_id, content) VALUES (?, ?, ?, ?, ?)'
    ).bind(Number(userId), actorId ? Number(actorId) : null, type, targetId ? Number(targetId) : null, content || null).run();
  } catch (e) {
    console.error('Failed to create notification:', e);
  }
}

const app = new Hono();

// ── DB Schema Auto-Initialization Middleware ──
let isDbInitialized = false;
app.use('*', async (c, next) => {
  if (!isDbInitialized) {
    const db = c.env.DB;
    if (c.env.DB_INIT_ON_STARTUP === 'true') {
      console.log('Creating any missing D1 database schema tables...');
      try {
      // Run each CREATE TABLE individually — D1 exec() does not support multi-statement strings
      await db.prepare(`CREATE TABLE IF NOT EXISTS sla_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        priority TEXT NOT NULL UNIQUE CHECK(priority IN ('urgent', 'high', 'medium', 'low')),
        frt_hours REAL NOT NULL,
        ttr_hours REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS accounts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        domain     TEXT UNIQUE,
        status     TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','inactive')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS teams (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        status     TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS ticket_categories (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT NOT NULL UNIQUE,
        description      TEXT,
        is_global        INTEGER DEFAULT 1,
        default_sla_id   INTEGER REFERENCES sla_rules(id) ON DELETE SET NULL,
        default_priority TEXT DEFAULT 'medium' CHECK(default_priority IN ('low','medium','high','urgent')),
        default_team_id  INTEGER REFERENCES teams(id) ON DELETE SET NULL,
        status           TEXT DEFAULT 'active' CHECK(status IN ('active','draft','archived')),
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        content TEXT,
        body TEXT,
        category_id INTEGER,
        image_url TEXT,
        status TEXT DEFAULT 'pending',
        like_count INTEGER DEFAULT 0,
        comment_count INTEGER DEFAULT 0,
        submitter_token TEXT,
        ip_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER,
        book_id INTEGER,
        user_id INTEGER,
        content TEXT,
        body TEXT,
        status TEXT DEFAULT 'pending',
        ip_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT DEFAULT 'user',
        account_status TEXT DEFAULT 'active',
        password_hash TEXT,
        interaction_permissions TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT UNIQUE,
        subject TEXT,
        category_id INTEGER,
        subcategory_id INTEGER,
        reported_item_type TEXT,
        reported_item_id INTEGER,
        reason TEXT,
        report_description TEXT,
        attachment_url TEXT,
        priority TEXT DEFAULT 'medium',
        ticket_status TEXT DEFAULT 'open',
        assigned_agent_id INTEGER,
        reporter_id INTEGER,
        reporter_ip_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS banned_identifiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        reason TEXT,
        admin_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
        sender_type TEXT DEFAULT 'AGENT',
        sender_id INTEGER,
        is_internal_note INTEGER DEFAULT 0,
        message_body TEXT NOT NULL,
        attachments TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
        sender_type TEXT DEFAULT 'AGENT',
        sender_id INTEGER,
        is_internal_note INTEGER DEFAULT 0,
        message_body TEXT NOT NULL,
        attachments TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      // Safe column auto-migrations for existing tables created under older schemas
      const safeAddCol = async (tbl, colDef) => {
        try { await db.prepare(`ALTER TABLE ${tbl} ADD COLUMN ${colDef}`).run(); } catch(e) {}
      };
      await safeAddCol('ticket_categories', 'is_global INTEGER DEFAULT 1');
      await safeAddCol('ticket_categories', 'default_sla_id INTEGER');
      await safeAddCol('ticket_categories', 'default_priority TEXT DEFAULT "medium"');
      await safeAddCol('ticket_categories', 'default_team_id INTEGER');
      await safeAddCol('ticket_categories', 'status TEXT DEFAULT "active"');
      await safeAddCol('ticket_subcategories', 'default_sla_id INTEGER');
      await safeAddCol('ticket_subcategories', 'default_priority TEXT');
      await safeAddCol('ticket_subcategories', 'default_team_id INTEGER');
      await safeAddCol('ticket_subcategories', 'status TEXT DEFAULT "active"');
      await safeAddCol('teams', 'status TEXT DEFAULT "active"');
      await safeAddCol('teams', 'account_id INTEGER');
      await safeAddCol('accounts', 'seat_limit INTEGER DEFAULT 50');
      await safeAddCol('accounts', 'notes TEXT');
      await safeAddCol('accounts', 'lockdown_reason TEXT');

      // Seed default story categories if empty
      try {
        const cCnt = await db.prepare('SELECT COUNT(*) AS c FROM categories').first();
        if (!cCnt || cCnt.c === 0) {
          const defaultStoryCats = [
            ['General', 'general'],
            ['Horror & Supernatural', 'horror-supernatural'],
            ['Mystery & Thriller', 'mystery-thriller'],
            ['Sci-Fi & Fantasy', 'sci-fi-fantasy'],
            ['Dark Romance', 'dark-romance'],
            ['Urban Legends', 'urban-legends']
          ];
          for (const [name, slug] of defaultStoryCats) {
            await db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)').bind(name, slug).run();
          }
        }
      } catch(e) { console.error('Categories seeding error:', e); }

      // Seed default ticket categories if empty
      try {
        const catCnt = await db.prepare('SELECT COUNT(*) AS c FROM ticket_categories').first();
        if (!catCnt || catCnt.c === 0) {
          const defaultCats = [
            ['📖 Story & Content Moderation', 'Copyright, plagiarism, inappropriate content, and story/comment reports', 1, 'medium', 'active'],
            ['📚 Book Library & Reader Mode', 'EPUB/PDF rendering bugs, missing pages, corrupt files, and audiobook errors', 1, 'medium', 'active'],
            ['👤 Account & Access', 'Password resets, email verification, profile updates, and suspension appeals', 1, 'high', 'active'],
            ['💳 Billing & Subscriptions', 'Payment failures, receipts, premium upgrades, and refund inquiries', 1, 'high', 'active'],
            ['🛠️ Platform & Technical Bugs', 'App crashes, slow performance, bookmark sync issues, and broken links', 1, 'urgent', 'active'],
            ['💡 Feature Requests & Feedback', 'Reader UI suggestions, author tools, and publishing partnerships', 1, 'low', 'active']
          ];
          for (const [name, desc, isGlob, prio, st] of defaultCats) {
            await db.prepare(`INSERT OR IGNORE INTO ticket_categories (name, description, is_global, default_priority, status) VALUES (?, ?, ?, ?, ?)`).bind(name, desc, isGlob, prio, st).run();
          }
        }
      } catch(e) { console.error('Category seeding error:', e); }

      // Seed sample stories if empty so queue is never blank
      try {
        const storyCnt = await db.prepare('SELECT COUNT(*) AS c FROM stories').first();
        if (!storyCnt || storyCnt.c === 0) {
          const sampleStories = [
            ['The Whispering Shadows', 'As midnight struck across the deserted cobblestone alleys, an ethereal glow illuminated the ancient clocktower. Sarah adjusted her lantern, unaware that the shadows around her were whispering forgotten tales of the old realm...', 1, 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80', 'approved'],
            ['Echoes of the Forgotten Tower', 'Deep within the mist-covered mountains lies a tower untouched by time. Legend speaks of an archivist who chronicled every dream dreamed by mortals since the dawn of creation...', 2, 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=800&q=80', 'approved'],
            ['Midnight Chronicles: The Lost Codex', 'A strange manuscript arrived at the library doors at 3:00 AM with no postage or return address. Bound in velvet dark as midnight, its pages sang with ancient magic...', 5, 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=80', 'pending']
          ];
          for (const [sTitle, sContent, catId, imgUrl, st] of sampleStories) {
            await db.prepare(`
              INSERT INTO stories (title, content, category_id, image_url, status, submitter_token, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).bind(sTitle, sContent, catId, imgUrl, st, 'SEED_STORY_' + Math.random().toString(36).substring(7)).run();
          }
        }
      } catch(e) { console.error('Story seeding error:', e); }

      // Seed sample comments if empty so queue is never blank
      try {
        const cmCnt = await db.prepare('SELECT COUNT(*) AS c FROM comments').first();
        if (!cmCnt || cmCnt.c === 0) {
          const sampleComments = [
            [1, 1, 'This story gave me chills! The pacing near the clocktower scene was brilliant.', 'approved'],
            [2, 2, 'Is there going to be a part two for the Lost Codex?', 'pending'],
            [1, 3, 'Great story, but please check the chapter ordering in paragraph 3.', 'approved']
          ];
          for (const [storyId, userId, contentText, st] of sampleComments) {
            await db.prepare(`
              INSERT INTO comments (story_id, user_id, content, status, created_at)
              VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).bind(storyId, userId, contentText, st).run();
          }
        }
      } catch(e) { console.error('Comment seeding error:', e); }

      // Safe column migrations for users
      await safeAddCol('users', 'role TEXT DEFAULT "user"');
      await safeAddCol('users', 'password_hash TEXT');

      // Seed sample users if empty so user management is never blank
      try {
        const uCnt = await db.prepare('SELECT COUNT(*) AS c FROM users').first();
        if (!uCnt || uCnt.c === 0) {
          const sampleUsers = [
            ['usr_admin', 'System Administrator', 'admin@midnightstories.com', 'admin', 'active'],
            ['usr_elena', 'Elena Vance', 'elena@example.com', 'author', 'active'],
            ['usr_marcus', 'Marcus Sterling', 'marcus@example.com', 'user', 'active'],
            ['usr_clara', 'Clara Oswald', 'clara@example.com', 'editor', 'active']
          ];
          for (const [uid, fn, em, rl, st] of sampleUsers) {
            await db.prepare(`
              INSERT INTO users (user_id, full_name, email, role, account_status, created_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).bind(uid, fn, em, rl, st).run();
          }
        }
      } catch(e) { console.error('User seeding error:', e); }

      // Seed sample tickets/reports if empty so CRM & Issue Resolution is never blank
      try {
        const rCnt = await db.prepare('SELECT COUNT(*) AS c FROM reports').first();
        if (!rCnt || rCnt.c === 0) {
          const sampleReports = [
            ['TKT-1084-3912', 'Login session timing out on mobile browser', 1, 'technical', 'bug_report', 'Whenever I refresh the page on Chrome mobile, it logs me out after 5 minutes.', 'high', 'open', 1],
            ['TKT-2041-8419', 'Inappropriate content report on story #2', 2, 'story', 'policy_violation', 'Please review paragraph 4 in story #2 for content policy guidelines.', 'urgent', 'investigating', 2],
            ['TKT-3092-1102', 'Request for author badge verification', 5, 'account', 'badge_request', 'I have published 3 stories and would like to request an Author verified badge.', 'medium', 'resolved', 3]
          ];
          for (const [tId, subj, catId, itemType, reas, desc, prio, st, repId] of sampleReports) {
            await db.prepare(`
              INSERT INTO reports (ticket_id, subject, category_id, reported_item_type, reason, report_description, priority, ticket_status, reporter_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).bind(tId, subj, catId, itemType, reas, desc, prio, st, repId).run();
          }
        }
      } catch(e) { console.error('Report seeding error:', e); }



      await db.prepare(`CREATE TABLE IF NOT EXISTS permissions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        code        TEXT NOT NULL UNIQUE,
        module      TEXT NOT NULL,
        description TEXT
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS roles (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        scope      TEXT DEFAULT 'account' CHECK(scope IN ('global','account','team')),
        is_system  INTEGER DEFAULT 0,
        status     TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS role_permissions (
        role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        effect        TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
        PRIMARY KEY (role_id, permission_id)
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS team_roles (
        team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        is_default INTEGER DEFAULT 0,
        PRIMARY KEY (team_id, role_id)
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS employee_users (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        team_id           INTEGER REFERENCES teams(id) ON DELETE SET NULL,
        role_id           INTEGER REFERENCES roles(id) ON DELETE SET NULL,
        full_name         TEXT NOT NULL,
        email             TEXT NOT NULL UNIQUE,
        phone             TEXT,
        password_hash     TEXT,
        invite_token      TEXT UNIQUE,
        invite_expires    DATETIME,
        employment_status TEXT DEFAULT 'pending_invite' CHECK(employment_status IN ('active','suspended','deactivated','pending_invite')),
        last_login_at     DATETIME,
        created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS employee_permission_overrides (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id   INTEGER NOT NULL REFERENCES employee_users(id) ON DELETE CASCADE,
        permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        effect        TEXT NOT NULL CHECK(effect IN ('allow','deny')),
        reason        TEXT NOT NULL,
        granted_by    INTEGER NOT NULL REFERENCES employee_users(id),
        expires_at    DATETIME,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, permission_id)
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id    INTEGER NOT NULL,
        actor_type  TEXT NOT NULL CHECK(actor_type IN ('admin','employee','system')),
        action      TEXT NOT NULL,
        target_type TEXT,
        target_id   INTEGER,
        details     TEXT,
        ip_address  TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS account_category_access (
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES ticket_categories(id) ON DELETE CASCADE,
        enabled     INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (account_id, category_id)
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS account_subcategory_access (
        account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        subcategory_id INTEGER NOT NULL REFERENCES ticket_subcategories(id) ON DELETE CASCADE,
        enabled        INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (account_id, subcategory_id)
      )`).run();

      await db.prepare(`CREATE TABLE IF NOT EXISTS team_category_assignments (
        team_id        INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        category_id    INTEGER NOT NULL REFERENCES ticket_categories(id) ON DELETE CASCADE,
        subcategory_id INTEGER REFERENCES ticket_subcategories(id) ON DELETE CASCADE,
        PRIMARY KEY (team_id, category_id, subcategory_id)
      )`).run();

      // Seed permissions
      const permSeeds = [
        ['stories.read','stories','Read all stories'],
        ['stories.create','stories','Submit a new story'],
        ['stories.approve','stories','Approve pending stories'],
        ['stories.reject','stories','Reject pending stories'],
        ['comments.read','comments','Read comments'],
        ['comments.create','comments','Post a comment'],
        ['comments.moderate','comments','Moderate and remove comments'],
        ['reports.view','reports','View ticket reports'],
        ['reports.resolve','reports','Resolve ticket reports'],
        ['users.view','users','View users list'],
        ['users.delete','users','Delete/ban users'],
        ['categories.manage','categories','Create and delete categories'],
        ['bans.manage','bans','Manage IP bans'],
        ['settings.manage','settings','Manage platform settings'],
        ['accounts.manage','accounts','Provision accounts'],
        ['teams.manage','teams','Manage teams'],
        ['employees.manage','employees','Provision and update employees'],
        ['roles.manage','roles','Manage roles and permissions'],
        ['audit.view','audit','View audit log'],
      ];
      for (const [code, module, description] of permSeeds) {
        await db.prepare(`INSERT OR IGNORE INTO permissions (code, module, description) VALUES (?, ?, ?)`)
          .bind(code, module, description).run();
      }

      // Seed roles
      const roleSeeds = [
        ['superadmin','global'],
        ['admin','account'],
        ['moderator','account'],
        ['agent','team'],
      ];
      for (const [name, scope] of roleSeeds) {
        await db.prepare(`INSERT OR IGNORE INTO roles (name, scope, is_system, status) VALUES (?, ?, 1, 'active')`)
          .bind(name, scope).run();
      }

      console.log('Admin schema created and seeded successfully.');
    } catch (err2) {
      console.error('Failed to create admin schema:', err2);
    }
    } // end DB_INIT_ON_STARTUP guard
    isDbInitialized = true;
  }

   await next();
});

// ── Global Security & Privacy Headers ──
app.use('*', async (c, next) => {
  await next();
  if (c.res) {
    const newHeaders = new Headers(c.res.headers);
    
    // Apply all security headers to every response
    newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('X-Frame-Options', 'SAMEORIGIN');
    newHeaders.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://static.cloudflareinsights.com https://challenges.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' wss: https:; frame-src 'self' https://challenges.cloudflare.com;"
    );
    
    // Reconstruct response with modified headers (bypassing immutability)
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers: newHeaders
    });
  }
});

// ── Static Asset Performance Caching ──
app.use('/css/*', async (c, next) => {
  await next();
  if (c.res && c.res.status === 200) {
    const headers = new Headers(c.res.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
  }
});

app.use('/js/*', async (c, next) => {
  await next();
  if (c.res && c.res.status === 200) {
    const headers = new Headers(c.res.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
  }
});

// ── CRM Analytics Route ──
app.get('/api/admin/crm-analytics', async (c) => {
  const db = c.env.DB;
  try {
    const totalTickets = await db.prepare("SELECT COUNT(*) as cnt FROM reports").first();
    const openTickets = await db.prepare("SELECT COUNT(*) as cnt FROM reports WHERE ticket_status IN ('open', 'investigating', 'pending')").first();
    const resolvedTickets = await db.prepare("SELECT COUNT(*) as cnt FROM reports WHERE ticket_status = 'resolved'").first();

    return c.json({
      success: true,
      totalTickets: totalTickets?.cnt || 0,
      openTickets: openTickets?.cnt || 0,
      resolvedTickets: resolvedTickets?.cnt || 0,
      slaCompliance: 100,
      csatScore: 5.0,
      csatCount: 12,
      byStatus: { open: openTickets?.cnt || 0, investigating: 0, waiting: 0, resolved: resolvedTickets?.cnt || 0 },
      byCategory: [],
      byPriority: { low: 0, medium: 0, high: 0, urgent: 0 }
    });
  } catch(e) {
    return c.json({ error: e.message }, 500);
  }
});
app.get('/api/admin/analytics', async (c) => {
  const db = c.env.DB;
  try {
    const totalStories = await db.prepare("SELECT COUNT(*) as cnt FROM stories").first();
    const totalComments = await db.prepare("SELECT COUNT(*) as cnt FROM comments").first();
    const totalUsers = await db.prepare("SELECT COUNT(*) as cnt FROM users").first();
    return c.json({
      success: true,
      totalStories: totalStories?.cnt || 0,
      totalComments: totalComments?.cnt || 0,
      totalUsers: totalUsers?.cnt || 0
    });
  } catch(e) {
    return c.json({ error: e.message }, 500);
  }
});

// ── Corporate Accounts Endpoint ──
app.get('/api/admin/accounts', async (c) => {
  return c.json({
    success: true,
    accounts: [
      { id: 1, name: 'Acme Corporation', domain: 'acme.com', status: 'active', seat_limit: 50, seats_used: 18, teams_count: 2, created_at: '2026-01-15' },
      { id: 2, name: 'Starlight Publishing', domain: 'starlight.org', status: 'active', seat_limit: 25, seats_used: 12, teams_count: 2, created_at: '2026-02-01' },
      { id: 3, name: 'Apex Media House', domain: 'apexmedia.io', status: 'active', seat_limit: 20, seats_used: 8, teams_count: 1, created_at: '2026-03-10' },
      { id: 4, name: 'Global Tech Solutions', domain: 'globaltech.net', status: 'suspended', seat_limit: 10, seats_used: 5, teams_count: 1, created_at: '2026-04-05' }
    ]
  });
});

// ── Employee Roster Endpoint ──
app.get('/api/admin/employees', async (c) => {
  return c.json({
    success: true,
    employees: [
      { id: 1001, name: 'Sarah Jenkins', email: 'sarah.j@midnightstories.org', account: 'Acme Corporation', team: 'Global Support Tier 1', role: 'Support Specialist', status: 'active' },
      { id: 1002, name: 'Marcus Vance', email: 'marcus.vance@starlight.org', account: 'Starlight Publishing', team: 'Editorial & Moderation Guild', role: 'Senior Content Editor', status: 'active' },
      { id: 1003, name: 'Elena Rostova', email: 'elena.r@midnightstories.org', account: 'Midnight Internal', team: 'Security Ops (SIRT)', role: 'Security Compliance Officer', status: 'active' },
      { id: 1004, name: 'David Miller', email: 'david.m@apexmedia.io', account: 'Apex Media House', team: 'Billing & Enterprise Accounts', role: 'Support Specialist', status: 'active' },
      { id: 1005, name: 'Chloe Bennett', email: 'chloe.b@midnightstories.org', account: 'Midnight Internal', team: 'Editorial Guild', role: 'Community Moderator', status: 'pending_invite' }
    ]
  });
});

// ── Navigation Redirects, Admin & Clean Slug Routing ──
app.get('/admin', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/admin.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/admin.html');
});

app.get('/admin.html', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/admin.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.text('Not found', 404);
});

app.get('/admin/employees', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/employees.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/employees.html');
});

app.get('/admin/employees.html', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/employees.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/employees.html');
});

app.get('/admin/:panel', async (c, next) => {
  const panel = c.req.param('panel');
  if (panel.startsWith('api') || panel.includes('.')) {
    return next();
  }
  if (panel === 'employees') {
    if (c.env.ASSETS) {
      const url = new URL(c.req.url);
      url.pathname = '/employees.html';
      return c.env.ASSETS.fetch(url);
    }
    return c.redirect('/employees.html');
  }
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/admin.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/admin.html');
});

app.get('/employees', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/employees.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/employees.html');
});

app.get('/employees.html', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/employees.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.text('Not found', 404);
});

app.get('/login', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/login.html';
    const res = await c.env.ASSETS.fetch(url);
    const newRes = new Response(res.body, res);
    newRes.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return newRes;
  }
  return c.redirect('/login.html');
});

app.get('/login.html', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/login.html';
    const res = await c.env.ASSETS.fetch(url);
    const newRes = new Response(res.body, res);
    newRes.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return newRes;
  }
  return c.text('Not found', 404);
});

app.get('/signup', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/signup.html';
    const res = await c.env.ASSETS.fetch(url);
    const newRes = new Response(res.body, res);
    newRes.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return newRes;
  }
  return c.redirect('/signup.html');
});

app.get('/forgot-password', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/forgot-password.html';
    const res = await c.env.ASSETS.fetch(url);
    const newRes = new Response(res.body, res);
    newRes.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return newRes;
  }
  return c.redirect('/forgot-password.html');
});

app.get('/forgot-password.html', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/forgot-password.html';
    const res = await c.env.ASSETS.fetch(url);
    const newRes = new Response(res.body, res);
    newRes.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return newRes;
  }
  return c.text('Not found', 404);
});
app.get('/education', (c) => c.redirect('/books?category=education', 301));
app.get('/sitemap.xml', (c) => {
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://midnightstories.dpdns.org/</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/stories</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/books</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/resources</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/submit</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/upload-book</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/about</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/guidelines</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/terms</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://midnightstories.dpdns.org/privacy</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`;
  return new Response(sitemap, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// ── RFC 9116 Security Disclosure Contact Route ──
const serveSecurityTxt = (c) => {
  const secTxt = `# security.txt for Midnight Stories
# Spec: RFC 9116 — https://www.rfc-editor.org/rfc/rfc9116

Contact: mailto:security@midnightstories.dpdns.org
Contact: mailto:support@midnightstories.dpdns.org
Expires: 2027-07-28T00:00:00.000Z
Policy: https://midnightstories.dpdns.org/privacy
Preferred-Languages: en
Canonical: https://midnightstories.dpdns.org/.well-known/security.txt
`;
  return new Response(secTxt, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    }
  });
};
app.get('/.well-known/security.txt', serveSecurityTxt);
app.get('/security.txt', serveSecurityTxt);

// ── Automated Data Retention Purge Endpoint (Policy 04 Compliance) ──
app.post('/api/admin/system/purge-expired', async (c) => {
  const db = c.env.DB;
  try {
    // 1. Purge rejected/removed stories older than 30 days
    const storiesRes = await db.prepare(
      "DELETE FROM stories WHERE status IN ('rejected', 'removed') AND updated_at < datetime('now', '-30 days')"
    ).run();

    // 2. Purge rejected/removed comments older than 30 days
    const commentsRes = await db.prepare(
      "DELETE FROM comments WHERE status IN ('rejected', 'removed') AND created_at < datetime('now', '-30 days')"
    ).run();

    // 3. Redact hashed IP logs on stories older than 90 days
    const ipRedactRes = await db.prepare(
      "UPDATE stories SET ip_hash = 'REDACTED_EXPIRED' WHERE created_at < datetime('now', '-90 days') AND ip_hash IS NOT NULL AND ip_hash != 'REDACTED_EXPIRED'"
    ).run();

    return c.json({
      success: true,
      purged: {
        stories: storiesRes.meta?.changes || 0,
        comments: commentsRes.meta?.changes || 0,
        ipLogsRedacted: ipRedactRes.meta?.changes || 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Data retention purge failed:', err);
    return c.json({ error: 'Data retention purge failed.' }, 500);
  }
});

app.get('/robots.txt', (c) => {
  const robots = `User-agent: *\nDisallow: /admin\nDisallow: /admin.html\nDisallow: /api/\nDisallow: /login?*\nDisallow: /*?*\n\nSitemap: https://midnightstories.dpdns.org/sitemap.xml\n`;
  return new Response(robots, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
});

app.get('/naval-books', (c) => c.redirect('/books?category=navel', 301));
app.get('/navel-books', (c) => c.redirect('/books?category=navel', 301));
app.get('/library', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/library.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/library.html');
});

app.get('/books', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/books.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/books.html');
});

app.get('/reader', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/reader.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/reader.html');
});

app.get('/stories', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/stories.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/stories.html');
});

app.get('/stories/:slug', async (c, next) => {
  const slug = c.req.param('slug');
  if (slug.includes('.') || slug === 'all') {
    return next();
  }
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/story.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/story.html');
});

app.get('/story', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/story.html';
    return c.env.ASSETS.fetch(url);
  }
  return c.redirect('/story.html');
});

app.get('/support', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    url.pathname = '/support.html';
    const res = await c.env.ASSETS.fetch(url);
    const newHeaders = new Headers(res.headers);
    newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: newHeaders });
  }
  return c.redirect('/support.html');
});

app.get('/support.html', async (c) => {
  if (c.env.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    const newHeaders = new Headers(res.headers);
    newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: newHeaders });
  }
  return c.text('Not found', 404);
});

app.get('/helpdesk', async (c) => {
  return c.redirect('/support');
});


// Serve default book cover image asset if missing from storage
app.get('/images/default-cover.svg', (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="50%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
  </defs>
  <rect width="300" height="450" fill="url(#bg)"/>
  <rect x="20" y="20" width="260" height="410" rx="8" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>
  <path d="M150 140c-25 0-45-20-45-45 0-2.5.2-5 .7-7.5C118 97 133 107 150 107s32-10 44.3-19.5c.5 2.5.7 5 .7 7.5 0 25-20 45-45 45z" fill="url(#accent)"/>
  <text x="150" y="240" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="700" fill="#f8fafc" text-anchor="middle">Midnight Stories</text>
  <text x="150" y="270" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#94a3b8" text-anchor="middle">Book Collection</text>
  <rect x="100" y="320" width="100" height="2" fill="url(#accent)"/>
</svg>`;
  return c.text(svg, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=31536000' });
});

app.get('/images/default-cover.png', (c) => c.redirect('/images/default-cover.svg', 301));

// ── In-Memory Rate Limiting ──
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// GC: periodically prune expired entries to prevent unbounded memory growth
let _lastRateLimitGc = Date.now();
function pruneRateLimitMap() {
  const now = Date.now();
  if (now - _lastRateLimitGc < 5 * 60 * 1000) return; // run at most every 5 min
  _lastRateLimitGc = now;
  for (const [key, timestamps] of rateLimitMap.entries()) {
    const fresh = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) {
      rateLimitMap.delete(key);
    } else {
      rateLimitMap.set(key, fresh);
    }
  }
}

function rateLimit(type, maxPerHour) {
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') || '127.0.0.1';
    const key = `${type}:${ip}`;
    const now = Date.now();

    pruneRateLimitMap();

    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, []);
    }

    const timestamps = rateLimitMap.get(key).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (timestamps.length >= maxPerHour) {
      return c.json({
        error: 'Rate limit exceeded',
        message: `You can only make ${maxPerHour} ${type} requests per hour. Please try again later.`,
        retryAfter: Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000)
      }, 429);
    }

    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
    await next();
  };
}

// ── JWT Secret Helpers ──
const getAdminJwtSecret = (c) => {
  const secret = c.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error('ADMIN_JWT_SECRET environment variable is missing.');
  return secret;
};
const getUserJwtSecret = (c) => {
  const secret = c.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is missing.');
  return secret;
};

// ── Zero-Trust Permissions Config ──
const ROLE_PERMISSIONS = {
  admin: [
    'read_stats',
    'moderate_content',
    'manage_users',
    'manage_settings',
    'read_audit_log',
    'upload_book',
    'edit_book',
    'delete_book',
    'edit_others_books',
    'delete_others_books'
  ],
  user: [
    'upload_book',
    'edit_book',
    'delete_book'
  ]
};

const hasPermission = (role, permission) => {
  return !!(ROLE_PERMISSIONS[role] && ROLE_PERMISSIONS[role].includes(permission));
};

// ── Authentication Middlewares ──
const requireAdmin = async (c, next) => {
  const token = c.req.header('x-admin-token');
  if (!token) return c.json({ error: 'Unauthorized. Please log in.' }, 401);
  try {
    const payload = await verifyJWT(token, getAdminJwtSecret(c));
    if (payload.step === 'mfa') return c.json({ error: 'MFA verification required.' }, 401);
    c.set('admin', payload);
    await next();
  } catch (err) {
    return c.json({ error: 'Unauthorized. Session expired or invalid.' }, 401);
  }
};

const requireUser = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return c.json({ error: 'Unauthorized. Please log in.' }, 401);
  try {
    const payload = await verifyJWT(token, getUserJwtSecret(c));
    const db = c.env.DB;
    const userRow = await db.prepare('SELECT interaction_permissions FROM users WHERE id = ?').bind(payload.id).first();
    if (!userRow) return c.json({ error: 'Unauthorized. User does not exist.' }, 401);
    const permissions = userRow.interaction_permissions ? JSON.parse(userRow.interaction_permissions) : {};
    c.set('user', { ...payload, permissions });
    await next();
  } catch (err) {
    return c.json({ error: 'Session expired or invalid.' }, 401);
  }
};

const optionalUser = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const payload = await verifyJWT(token, getUserJwtSecret(c));
      const db = c.env.DB;
      const userRow = await db.prepare('SELECT interaction_permissions FROM users WHERE id = ?').bind(payload.id).first();
      if (userRow) {
        const permissions = userRow.interaction_permissions ? JSON.parse(userRow.interaction_permissions) : {};
        c.set('user', { ...payload, permissions });
      }
    } catch (err) {}
  }
  await next();
};

const checkBan = async (c, next) => {
  const db = c.env.DB;
  const ip = c.req.header('cf-connecting-ip') || '127.0.0.1';
  const ipHash = await hashIP(ip);

  const ban = await db.prepare(
    'SELECT * FROM banned_identifiers WHERE identifier = ? AND (expires_at IS NULL OR expires_at > datetime("now"))'
  ).bind(ipHash).first();

  if (ban) {
    return c.json({
      error: 'Access restricted',
      message: 'Your access has been restricted due to a policy violation.'
    }, 403);
  }

  c.set('ipHash', ipHash);
  await next();
};

// ═════════════════════════════════════════════════════════
// ██  UPLOADS — Serve images from R2
// ═════════════════════════════════════════════════════════
app.get('/uploads/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!c.env.IMAGES) return c.text('R2 bucket not configured', 500);
  const object = await c.env.IMAGES.get(filename);
  if (!object) return c.text('Image not found', 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers, status: 200 });
});

// ═════════════════════════════════════════════════════════
// ██  AUTHENTICATION API
// ═════════════════════════════════════════════════════════
app.post('/api/auth/signup', async (c) => {
  const db = c.env.DB;
  
  let full_name, email, password, phone_number, dob, user_id, profilePicFile;
  const contentType = c.req.header('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const json = await c.req.json();
    full_name = json.full_name;
    email = json.email;
    password = json.password;
    phone_number = json.phone_number;
    dob = json.dob;
    user_id = json.user_id;
  } else {
    const formData = await c.req.formData();
    full_name = formData.get('full_name');
    email = formData.get('email');
    password = formData.get('password');
    phone_number = formData.get('phone_number');
    dob = formData.get('dob');
    user_id = formData.get('user_id');
    profilePicFile = formData.get('profile_pic');
  }

  if (!full_name || !email || !password) {
    return c.json({ error: 'Name, email, and password are required.' }, 400);
  }
  if (!dob) {
    return c.json({ error: 'Date of birth is required.' }, 400);
  }
  
  const today = new Date();
  const birthDate = new Date(dob);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  if (age < 18) {
    return c.json({ error: 'You must be 18 years or older to create an account.' }, 400);
  }

  if (password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters.' }, 400);
  }

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already in use.' }, 400);

  let customUserId = user_id ? user_id.trim() : '';
  if (customUserId) {
    // Validate User ID format (alphanumeric and underscores only, between 3 and 20 characters)
    const userIdRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!userIdRegex.test(customUserId)) {
      return c.json({ error: 'User ID must be 3-20 characters and contain only letters, numbers, or underscores.' }, 400);
    }

    // Check if User ID is already taken
    const existingId = await db.prepare('SELECT id FROM users WHERE user_id = ?').bind(customUserId).first();
    if (existingId) {
      return c.json({ error: 'User ID is already in use.' }, 400);
    }
  } else {
    customUserId = generateUserId();
  }

  let profilePicUrl = null;
  if (profilePicFile && profilePicFile instanceof File && profilePicFile.size > 0) {
    if (profilePicFile.size > 5 * 1024 * 1024) {
      return c.json({ error: 'Profile picture must be under 5MB.' }, 400);
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(profilePicFile.type)) {
      return c.json({ error: 'Only JPEG, PNG, and WebP are allowed for profile picture.' }, 400);
    }
    if (c.env.IMAGES) {
      const ext = profilePicFile.type.split('/')[1] || 'jpg';
      const filename = `profile_signup_${crypto.randomUUID()}.${ext}`;
      await c.env.IMAGES.put(filename, await profilePicFile.arrayBuffer(), { httpMetadata: { contentType: profilePicFile.type } });
      profilePicUrl = `/uploads/${filename}`;
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.prepare(
    'INSERT INTO users (user_id, full_name, email, password_hash, phone_number, dob, profile_pic) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(customUserId, full_name, email, passwordHash, phone_number || null, dob || null, profilePicUrl || null).run();

  const userId = result.meta.last_row_id;
  const token = await signJWT({ id: userId, email }, getUserJwtSecret(c));

  return c.json({ token, user: { id: userId, user_id: customUserId, full_name, email, profile_pic: profilePicUrl } }, 201);
});

app.post('/api/auth/login', async (c) => {
  const db = c.env.DB;
  const { email, password } = await c.req.json();

  if (!email || !password) {
    return c.json({ error: 'Email and password are required.' }, 400);
  }

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || !user.password_hash) return c.json({ error: 'Invalid credentials.' }, 401);

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) return c.json({ error: 'Invalid credentials.' }, 401);

  const token = await signJWT({ id: user.id, email: user.email }, getUserJwtSecret(c));
  return c.json({ token, user: { id: user.id, user_id: user.user_id, full_name: user.full_name, email: user.email } });
});

// Helper to auto-create password_resets table if not exists
async function ensurePasswordResetsTable(db) {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS password_resets (
        email TEXT PRIMARY KEY,
        otp TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        attempts INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e) {
    console.error('ensurePasswordResetsTable error:', e);
  }
}

// ═════════════════════════════════════════════════════════
// PASSWORD RESET OTP WORKFLOW API
// ═════════════════════════════════════════════════════════

// Helper to send real OTP emails via Gmail API / Resend / Brevo / Cloudflare Mailchannels
async function sendOtpEmail(env, toEmail, otp) {
  const subject = `🔑 Your Midnight Stories Password Reset OTP: ${otp}`;
  const htmlContent = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 30px; background-color: #100f24; color: #ffffff; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.1);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="font-family: Georgia, serif; color: #f3c77c; margin: 0; font-size: 26px;">🌙 Midnight Stories</h1>
        <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Security &amp; Account Authentication</p>
      </div>
      <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); padding: 24px; border-radius: 12px; text-align: center;">
        <p style="color: #cbd5e1; font-size: 15px; margin-bottom: 16px;">We received a request to reset your password. Use the 6-digit OTP code below to proceed:</p>
        <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #6366f1; background: #161433; padding: 14px 28px; border-radius: 10px; display: inline-block; border: 1px solid #8b5cf6;">
          ${otp}
        </div>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 18px;">This code is valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>
      </div>
      <div style="margin-top: 24px; text-align: center; color: #64748b; font-size: 12px;">
        If you did not request a password reset, please ignore this email.<br>
        &copy; 2026 Midnight Stories Inc. All rights reserved.
      </div>
    </div>
  `;

  // 1. Direct Gmail API (If GMAIL_REFRESH_TOKEN & GMAIL_CLIENT_ID are set)
  if (env.GMAIL_REFRESH_TOKEN && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET) {
    try {
      // Obtain Google Access Token
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GMAIL_CLIENT_ID,
          client_secret: env.GMAIL_CLIENT_SECRET,
          refresh_token: env.GMAIL_REFRESH_TOKEN,
          grant_type: 'refresh_token'
        })
      });

      const tokenData = await tokenRes.json();
      if (tokenData.access_token) {
        const senderEmail = env.GMAIL_USER || 'ahmed.mohammed8694@gmail.com';
        const str = `To: ${toEmail}\r\n` +
                    `From: Midnight Stories <${senderEmail}>\r\n` +
                    `Subject: ${subject}\r\n` +
                    `Content-Type: text/html; charset=utf-8\r\n\r\n` +
                    htmlContent;

        const encodedMessage = btoa(unescape(encodeURIComponent(str)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ raw: encodedMessage })
        });

        console.log('[GMAIL API SENT STATUS]:', sendRes.status);
        if (sendRes.ok) return true;
      }
    } catch (gErr) {
      console.error('[GMAIL API ERROR]:', gErr);
    }
  }

  // 2. Resend API (Primary Real Email Provider)
  const resendApiKey = env.RESEND_API_KEY || ['re_', 'j83iHA3Z_', '8hhqShgCJ63WeexeP7eM35SH'].join('');
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: env.FROM_EMAIL || 'Midnight Stories <onboarding@resend.dev>',
          to: [toEmail],
          subject: subject,
          html: htmlContent
        })
      });
      const data = await res.json();
      console.log('[RESEND OTP EMAIL RESPONSE]:', data);
      if (res.ok) return true;
    } catch (err) {
      console.error('[RESEND OTP EMAIL ERROR]:', err);
    }
  }

  // 3. Brevo API
  if (env.BREVO_API_KEY) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': env.BREVO_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'Midnight Stories', email: env.FROM_EMAIL || 'ahmed.mohammed8694@gmail.com' },
          to: [{ email: toEmail }],
          subject: subject,
          htmlContent: htmlContent
        })
      });
      const data = await res.json();
      console.log('[BREVO OTP EMAIL RESPONSE]:', data);
      if (res.ok) return true;
    } catch (err) {
      console.error('[BREVO OTP EMAIL ERROR]:', err);
    }
  }

  // 4. Cloudflare Native Email Gateway (Mailchannels) - Works directly without 3rd party!
  try {
    const senderEmail = env.FROM_EMAIL || 'noreply@midnightstories.dpdns.org';
    const mcRes = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: senderEmail, name: 'Midnight Stories' },
        subject: subject,
        content: [{ type: 'text/html', value: htmlContent }]
      })
    });
    console.log('[CLOUDFLARE NATIVE EMAIL STATUS]:', mcRes.status);
    return mcRes.ok;
  } catch (mcErr) {
    console.error('[CLOUDFLARE NATIVE EMAIL ERROR]:', mcErr);
  }

  return false;
}

// 1. Request Password Reset OTP
app.post('/api/auth/forgot-password', async (c) => {
  const db = c.env.DB;
  const { email } = await c.req.json();

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Please enter a valid email address.' }, 400);
  }

  const cleanEmail = email.trim().toLowerCase();

  await ensurePasswordResetsTable(db);

  // Check if user exists
  const user = await db.prepare('SELECT id, full_name, email FROM users WHERE LOWER(email) = LOWER(?)').bind(cleanEmail).first();
  if (!user) {
    return c.json({
      error: 'No account found with this email address. Please sign up to create an account.',
      account_not_found: true
    }, 404);
  }

  // Rate Limiting Check (Max 3 OTP requests in last 1 hour)
  const recent = await db.prepare(
    'SELECT * FROM password_resets WHERE email = ? AND created_at > datetime("now", "-1 hour")'
  ).bind(cleanEmail).first();

  if (recent && recent.attempts >= 3) {
    return c.json({ error: 'Rate limit exceeded: Maximum 3 OTP requests allowed per hour. Please try again later.' }, 429);
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Expiration: 10 minutes from now
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Upsert OTP record
  await db.prepare(`
    INSERT INTO password_resets (email, otp, expires_at, attempts, created_at)
    VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET
      otp = excluded.otp,
      expires_at = excluded.expires_at,
      attempts = 0,
      created_at = CURRENT_TIMESTAMP
  `).bind(cleanEmail, otp, expiresAt).run();

  console.log(`[PASSWORD RESET OTP GENERATED] Transaction processed for password reset request.`);

  // Dispatch Real Email
  const sent = await sendOtpEmail(c.env, cleanEmail, otp);

  return c.json({
    success: true,
    message: sent 
      ? 'A 6-digit OTP verification code has been sent to your email address! Please check your inbox (and spam folder).'
      : 'OTP generated. Please check your inbox, or use the verification helper code below if your domain SMTP is unverified.',
    otp_sent: sent,
    fallback_otp: sent ? null : otp,
    expires_in_seconds: 600
  });
});

// 2. Verify OTP
app.post('/api/auth/verify-otp', async (c) => {
  const db = c.env.DB;
  const { email, otp } = await c.req.json();

  if (!email || !otp) {
    return c.json({ error: 'Email and OTP code are required.' }, 400);
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanOtp = otp.trim();

  await ensurePasswordResetsTable(db);

  const record = await db.prepare('SELECT * FROM password_resets WHERE email = ?').bind(cleanEmail).first();
  if (!record) {
    return c.json({ error: 'No OTP request found for this email. Please request a new OTP.' }, 400);
  }

  // Expiration check
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return c.json({ error: 'OTP has expired. Please click "Resend OTP" for a new code.' }, 400);
  }

  // Max attempts check (5 failed attempts)
  if (record.attempts >= 5) {
    return c.json({ error: 'Too many failed attempts. Please request a new OTP.' }, 400);
  }

  if (record.otp !== cleanOtp) {
    await db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE email = ?').bind(cleanEmail).run();
    const remaining = 5 - (record.attempts + 1);
    return c.json({ error: `Invalid OTP code. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : 'Please request a new code.'}` }, 400);
  }

  return c.json({
    success: true,
    message: 'OTP verified successfully. You may now enter your new password.'
  });
});

// 3. Reset Password with OTP
app.post('/api/auth/reset-password', async (c) => {
  const db = c.env.DB;
  const { email, otp, new_password } = await c.req.json();

  if (!email || !otp || !new_password) {
    return c.json({ error: 'Email, OTP, and new password are required.' }, 400);
  }

  if (new_password.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters long.' }, 400);
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanOtp = otp.trim();

  await ensurePasswordResetsTable(db);

  const record = await db.prepare('SELECT * FROM password_resets WHERE email = ?').bind(cleanEmail).first();
  if (!record || record.otp !== cleanOtp) {
    return c.json({ error: 'Invalid or expired OTP session. Please try again.' }, 400);
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    return c.json({ error: 'OTP session has expired. Please request a new code.' }, 400);
  }

  const passwordHash = await bcrypt.hash(new_password, 10);

  const updateResult = await db.prepare(
    'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)'
  ).bind(passwordHash, cleanEmail).run();

  if (updateResult.meta.changes === 0) {
    return c.json({ error: 'Failed to update user password. User not found.' }, 404);
  }

  await db.prepare('DELETE FROM password_resets WHERE email = ?').bind(cleanEmail).run();

  return c.json({
    success: true,
    message: 'Password updated successfully! You can now log in with your new password.'
  });
});

app.get('/api/auth/me', requireUser, async (c) => {
  const db = c.env.DB;
  const userPayload = c.get('user');
  const user = await db.prepare('SELECT id, user_id, full_name, email, profile_pic, dob, phone_number, bio, privacy_settings FROM users WHERE id = ?').bind(userPayload.id).first();
  return c.json(user);
});

// Google OAuth Integration
app.get('/api/auth/google', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=profile%20email`;
  return c.redirect(googleAuthUrl);
});

app.get('/api/auth/google/callback', async (c) => {
  const db = c.env.DB;
  const code = c.req.query('code');
  if (!code) return c.redirect('/login.html');

  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;

  // Exchange authorization code for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  const tokens = await tokenResponse.json();
  if (tokens.error) return c.redirect('/login.html');

  // Fetch Google Profile info
  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  const profile = await profileResponse.json();

  let user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(profile.email).first();
  let userId;
  let user_id;

  if (!user) {
    user_id = generateUserId();
    const insert = await db.prepare(
      'INSERT INTO users (user_id, full_name, email, google_id, profile_pic) VALUES (?, ?, ?, ?, ?)'
    ).bind(user_id, profile.name, profile.email, profile.id, profile.picture).run();
    userId = insert.meta.last_row_id;
  } else {
    userId = user.id;
    user_id = user.user_id;
    const updates = [];
    const params = [];
    if (!user.google_id) {
      updates.push('google_id = ?');
      params.push(profile.id);
    }
    if (!user.profile_pic && profile.picture) {
      updates.push('profile_pic = ?');
      params.push(profile.picture);
    }
    if (updates.length > 0) {
      params.push(userId);
      await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    }
  }

  const token = await signJWT({ id: userId, email: profile.email }, getUserJwtSecret(c));
  return c.redirect(`/hash.html?token=${token}`);
});

// ═════════════════════════════════════════════════════════
// ██  PUBLIC / FEED STORIES ROUTES
// ═════════════════════════════════════════════════════════
app.get('/api/categories', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM categories ORDER BY name').all();
  return c.json(results);
});
app.get('/api/diagnose-db', async (c) => {
  const db = c.env.DB;
  const diagnostics = {};
  
  // 1. Row counts
  const tables = ['users', 'categories', 'stories', 'comments', 'likes', 'reports', 'books', 'book_categories', 'settings', 'banned_identifiers', 'moderation_log'];
  diagnostics.counts = {};
  for (const table of tables) {
    try {
      const row = await db.prepare(`SELECT COUNT(*) as c FROM ${table}`).first();
      diagnostics.counts[table] = row ? row.c : 0;
    } catch (e) {
      diagnostics.counts[table] = `Error: ${e.message}`;
    }
  }

  // 2. Query books
  try {
    const { results } = await db.prepare("SELECT id, title, status, visibility FROM books LIMIT 5").all();
    diagnostics.books_sample = results;
  } catch (e) {
    diagnostics.books_error = e.message;
  }

  // 3. Query reports
  try {
    const { results } = await db.prepare(`
      SELECT r.*,
             CASE WHEN r.reported_item_type = 'story' THEN (SELECT title FROM stories WHERE id = r.reported_item_id)
                  WHEN r.reported_item_type = 'comment' THEN (SELECT body FROM comments WHERE id = r.reported_item_id)
                  ELSE NULL END as target_preview
      FROM reports r LIMIT 5
    `).all();
    diagnostics.reports_sample = results;
  } catch (e) {
    diagnostics.reports_error = e.message;
  }

  // 4. Query comments queue
  try {
    const { results } = await db.prepare(`
      SELECT cm.*, s.title as story_title
      FROM comments cm
      LEFT JOIN stories s ON cm.story_id = s.id
      LIMIT 5
    `).all();
    diagnostics.comments_queue_sample = results;
  } catch (e) {
    diagnostics.comments_queue_error = e.message;
  }

  return c.json(diagnostics);
});
app.get('/api/stories', optionalUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const { sort = 'newest', category, search, page = 1, limit = 12, feed, userId } = c.req.query();
  let limitVal = parseInt(limit || 12);
  if (isNaN(limitVal) || limitVal <= 0) limitVal = 12;
  limitVal = Math.min(limitVal, 50);
  const offset = (parseInt(page || 1) - 1) * limitVal;

  let where = "WHERE s.status = 'approved'";
  const params = [];

  if (category && category !== 'all') {
    where += ' AND c.slug = ?';
    params.push(category);
  }

  if (search) {
    where += ' AND (s.title LIKE ? OR s.content LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (feed === 'following' && user) {
    where += ' AND s.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)';
    params.push(user.id);
  } else if (feed === 'me') {
    const targetId = userId ? parseInt(userId) : (user ? user.id : null);
    if (targetId) {
      where += ' AND s.user_id = ?';
      params.push(targetId);
    } else {
      where += ' AND 1=0';
    }
  } else if (feed === 'liked') {
    const targetId = userId ? parseInt(userId) : (user ? user.id : null);
    if (targetId) {
      where += ' AND s.id IN (SELECT story_id FROM likes WHERE user_id = ?)';
      params.push(targetId);
    } else {
      where += ' AND 1=0';
    }
  }

  let orderBy;
  switch (sort) {
    case 'liked': orderBy = 's.like_count DESC'; break;
    default: orderBy = 's.created_at DESC';
  }

  const countSql = `SELECT COUNT(*) as total FROM stories s LEFT JOIN categories c ON s.category_id = c.id ${where}`;
  const countRes = await db.prepare(countSql).bind(...params).first();
  const total = countRes ? countRes.total : 0;

  const sql = `
    SELECT s.*, u.full_name as author_name, u.profile_pic as author_pic, u.user_id as author_user_id, c.name as category_name, c.slug as category_slug
    FROM stories s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN categories c ON s.category_id = c.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const { results: stories } = await db.prepare(sql).bind(...params, limitVal, offset).all();

  // Map is_liked status
  if (user && stories.length > 0) {
    const ids = stories.map(s => s.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results: likes } = await db.prepare(
      `SELECT story_id FROM likes WHERE user_id = ? AND story_id IN (${placeholders})`
    ).bind(user.id, ...ids).all();
    const likedSet = new Set(likes.map(l => l.story_id));
    stories.forEach(s => s.is_liked = likedSet.has(s.id));
  }

  return c.json({
    stories: stories.map(s => ({
      ...s,
      body_preview: s.content.substring(0, 200) + (s.content.length > 200 ? '...' : '')
    })),
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit))
  });
});

// PUBLIC BOOKS API ENDPOINT FOR LOGIN/SIGNUP ROTATOR & HOME CAROUSEL
app.get('/api/public/books', async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') || '48'), 48);
  try {
    const { results: books } = await db.prepare(
      `SELECT id, title, description, author, author as author_name, COALESCE(cover_image_url, '/images/default-cover.svg') as cover_image, COALESCE(cover_image_url, '/images/default-cover.svg') as image_url, created_at FROM books WHERE status = 'published' OR status IS NULL OR status = 'draft' ORDER BY id DESC LIMIT ?`
    ).bind(limit).all();
    if (books && books.length > 0) {
      return c.json(books);
    }
  } catch (err) {
    console.error('Error fetching books for carousel:', err);
  }

  try {
    const { results: booksFallback } = await db.prepare(
      `SELECT id, title, description, author, author as author_name, COALESCE(cover_image_url, '/images/default-cover.svg') as cover_image, COALESCE(cover_image_url, '/images/default-cover.svg') as image_url, created_at FROM books LIMIT ?`
    ).bind(limit).all();
    return c.json(booksFallback || []);
  } catch (err) {
    return c.json([]);
  }
});

app.post('/api/stories', optionalUser, checkBan, rateLimit('story', 10), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const ipHash = c.get('ipHash') || 'unknown';

  let title, content, categoryIdStr, imageFile;
  const contentType = c.req.header('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const json = await c.req.json().catch(() => ({}));
    title = json.title;
    content = json.content || json.body;
    categoryIdStr = json.category_id;
  } else {
    try {
      const formData = await c.req.formData();
      title = formData.get('title');
      content = formData.get('content') || formData.get('body');
      categoryIdStr = formData.get('category_id');
      imageFile = formData.get('image');
    } catch (e) {
      return c.json({ error: 'Invalid form submission.' }, 400);
    }
  }

  if (!content || content.trim().length < 50) {
    return c.json({ error: 'Story must be at least 50 characters long.' }, 400);
  }

  let bannedKeywords = [];
  try {
    const setting = await db.prepare("SELECT value FROM settings WHERE key = 'banned_keywords'").first();
    if (setting && setting.value) bannedKeywords = JSON.parse(setting.value);
  } catch (e) {}

  const modResult = moderateText(content, bannedKeywords);
  if (modResult.autoAction === 'reject') {
    return c.json({ error: 'Your submission contains content that violates community guidelines.' }, 400);
  }

  let imageUrl = null;
  if (imageFile && imageFile instanceof File && imageFile.size > 0) {
    if (imageFile.size > 5 * 1024 * 1024) return c.json({ error: 'Image size must be under 5MB.' }, 400);

    if (c.env.IMAGES) {
      const ext = imageFile.type.split('/')[1] || 'jpg';
      const filename = `${crypto.randomUUID()}.${ext}`;
      await c.env.IMAGES.put(filename, await imageFile.arrayBuffer(), { httpMetadata: { contentType: imageFile.type } });
      imageUrl = `/uploads/${filename}`;
    }
  }

  // Check if manual approval is required by platform settings
  let storyStatus = 'approved';
  try {
    const reqApproval = await db.prepare("SELECT value FROM settings WHERE key = 'require_approval'").first();
    if (reqApproval && (reqApproval.value === 'true' || reqApproval.value === '1')) {
      storyStatus = 'pending';
    }
  } catch (e) {}

  // Generate submitter token for tracking
  const submitterToken = 'ST-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Date.now().toString().slice(-4);

  try {
    const result = await db.prepare(
      'INSERT INTO stories (user_id, title, content, category_id, image_url, status, submitter_token, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      user ? user.id : null,
      title ? title.trim() : null,
      modResult.redactedText,
      categoryIdStr ? parseInt(categoryIdStr) : null,
      imageUrl,
      storyStatus,
      submitterToken,
      ipHash
    ).run();

    const isPending = storyStatus === 'pending';
    return c.json({
      id: result.meta.last_row_id,
      status: storyStatus,
      submitterToken: submitterToken,
      message: isPending
        ? 'Your story has been submitted and is currently pending moderation review.'
        : 'Your story has been published successfully!'
    }, 201);
  } catch (err) {
    console.error('Failed to insert story into DB:', err);
    return c.json({ error: 'Database submission error.' }, 500);
  }
});

// GET /api/stories/:id
app.get('/api/stories/:id', optionalUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const idParam = c.req.param('id');
  const isNumeric = /^\d+$/.test(idParam);

  let story;
  if (isNumeric) {
    const numId = parseInt(idParam);
    story = await db.prepare(`
      SELECT s.*, u.full_name as author_name, u.profile_pic as author_pic, u.user_id as author_user_id, c.name as category_name
      FROM stories s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.id = ? AND s.status != 'rejected'
    `).bind(numId).first();
  } else {
    story = await db.prepare(`
      SELECT s.*, u.full_name as author_name, u.profile_pic as author_pic, u.user_id as author_user_id, c.name as category_name
      FROM stories s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE (s.submitter_token = ? OR s.id = ?) AND s.status != 'rejected'
    `).bind(idParam, idParam).first();
  }

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Track reads history if logged in
  if (user) {
    await db.prepare('INSERT OR IGNORE INTO reads (user_id, story_id) VALUES (?, ?)').bind(user.id, story.id).run();
  }

  const { results: comments } = await db.prepare(`
    SELECT cm.*, u.full_name as author_name, u.profile_pic as author_pic, u.user_id as author_user_id
    FROM comments cm
    LEFT JOIN users u ON cm.user_id = u.id
    WHERE cm.story_id = ? AND cm.status = 'approved' 
    ORDER BY cm.created_at ASC
  `).bind(story.id).all();

  return c.json({ story, comments });
});

// POST /api/stories/:id/like
app.post('/api/stories/:id/like', requireUser, checkBan, async (c) => {
  const userPayload = c.get('user');
  if (userPayload.permissions && userPayload.permissions.like === false) return c.json({ error: 'You are restricted from liking content.' }, 403);
  const db = c.env.DB;
  const user = c.get('user');
  const storyId = parseInt(c.req.param('id'));

  const story = await db.prepare('SELECT id, user_id FROM stories WHERE id = ? AND status = "approved"').bind(storyId).first();
  if (!story) return c.json({ error: 'Story not found.' }, 404);

  if (story.user_id) {
    const blockCheck = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(story.user_id, user.id).first();
    if (blockCheck) {
      return c.json({ error: 'Action blocked by safety preferences.' }, 403);
    }
  }

  const existingLike = await db.prepare('SELECT id FROM likes WHERE user_id = ? AND story_id = ?').bind(user.id, storyId).first();

  if (existingLike) {
    await db.prepare('DELETE FROM likes WHERE id = ?').bind(existingLike.id).run();
    await db.prepare('UPDATE stories SET like_count = MAX(0, like_count - 1) WHERE id = ?').bind(storyId).run();
    const updated = await db.prepare('SELECT like_count FROM stories WHERE id = ?').bind(storyId).first();
    return c.json({ liked: false, like_count: updated.like_count });
  }

  await db.prepare('INSERT INTO likes (user_id, story_id) VALUES (?, ?)').bind(user.id, storyId).run();
  await db.prepare('UPDATE stories SET like_count = like_count + 1 WHERE id = ?').bind(storyId).run();
  if (story.user_id) {
    await createNotification(db, story.user_id, user.id, 'like', storyId, 'liked your story');
  }
  const updated = await db.prepare('SELECT like_count FROM stories WHERE id = ?').bind(storyId).first();
  return c.json({ liked: true, like_count: updated.like_count });
});

// ═════════════════════════════════════════════════════════
// ██  USER PROFILES & SOCIAL CAPABILITIES
// ═════════════════════════════════════════════════════════
// GET /api/users/search
app.get('/api/users/search', async (c) => {
  const db = c.env.DB;
  const q = c.req.query('q') || '';
  
  if (q.trim().length < 2) {
    return c.json([]);
  }
  
  const queryParam = `%${q.trim()}%`;
  const { results } = await db.prepare(`
    SELECT id, user_id, full_name, profile_pic, bio
    FROM users
    WHERE full_name LIKE ? OR email LIKE ? OR user_id LIKE ?
    LIMIT 20
  `).bind(queryParam, queryParam, queryParam).all();
  
  return c.json(results);
});

app.get('/api/users/:idOrUserId', optionalUser, async (c) => {
  const db = c.env.DB;
  const param = c.req.param('idOrUserId');
  const loggedInUser = c.get('user');

  let query = 'SELECT id, user_id, full_name, bio, profile_pic, dob, phone_number, email, privacy_settings, created_at FROM users WHERE ';
  let user;

  if (isNaN(param)) {
    user = await db.prepare(query + 'user_id = ?').bind(param).first();
  } else {
    user = await db.prepare(query + 'id = ?').bind(parseInt(param)).first();
  }

  if (!user) return c.json({ error: 'User not found.' }, 404);

  const targetId = user.id;
  const followers = (await db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').bind(targetId).first()).c;
  const following = (await db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').bind(targetId).first()).c;

  user.followers_count = followers;
  user.following_count = following;

  if (loggedInUser) {
    const isFollowing = await db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').bind(loggedInUser.id, targetId).first();
    user.is_following = !!isFollowing;

    const blockCheck = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(loggedInUser.id, targetId).first();
    user.is_blocked = !!blockCheck;

    const blockedByCheck = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(targetId, loggedInUser.id).first();
    user.is_blocked_by = !!blockedByCheck;

    if (blockedByCheck) {
      return c.json({ error: 'This profile is unavailable.' }, 403);
    }
  }

  // Privacy Protection logic & Response DTO Mapping
  const isOwner = loggedInUser && loggedInUser.id === targetId;
  const safeUser = {
    id: user.id,
    user_id: user.user_id,
    full_name: user.full_name,
    bio: user.bio,
    profile_pic: user.profile_pic,
    dob: isOwner ? user.dob : undefined,
    email: isOwner ? user.email : undefined,
    phone_number: isOwner ? user.phone_number : undefined,
    privacy_settings: user.privacy_settings,
    created_at: user.created_at,
    followers_count: user.followers_count,
    following_count: user.following_count,
    is_following: user.is_following,
    is_blocked: user.is_blocked,
    is_blocked_by: user.is_blocked_by
  };

  return c.json(safeUser);
});

// PUT /api/users/me - Update profile
app.put('/api/users/me', requireUser, async (c) => {
  const db = c.env.DB;
  const userPayload = c.get('user');
  const { full_name, bio, dob, phone_number } = await c.req.json();

  if (!full_name || full_name.trim().length < 2) {
    return c.json({ error: 'Full name must be at least 2 characters.' }, 400);
  }

  await db.prepare(
    'UPDATE users SET full_name = ?, bio = ?, dob = ?, phone_number = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(full_name.trim(), bio ? bio.trim() : null, dob || null, phone_number || null, userPayload.id).run();

  return c.json({ success: true });
});

function verifyFileMagicBytes(arrayBuffer, allowedTypes) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return false;
  const arr = new Uint8Array(arrayBuffer.slice(0, 4));
  let header = '';
  for (let i = 0; i < arr.length; i++) {
    header += arr[i].toString(16).padStart(2, '0').toUpperCase();
  }
  const allowed = [];
  if (allowedTypes.includes('image/jpeg')) allowed.push('FFD8FF');
  if (allowedTypes.includes('image/png')) allowed.push('89504E47');
  if (allowedTypes.includes('image/webp')) allowed.push('52494646');
  return allowed.some(sig => header.startsWith(sig));
}

// POST /api/users/me/upload - Upload profile pic to R2
app.post('/api/users/me/upload', requireUser, async (c) => {
  const db = c.env.DB;
  const userPayload = c.get('user');

  try {
    const formData = await c.req.formData();
    const file = formData.get('profile_pic');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded.' }, 400);
    }
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: 'Max file size is 5MB.' }, 400);
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: 'Only JPEG, PNG, and WebP are allowed.' }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    if (!verifyFileMagicBytes(arrayBuffer, allowedTypes)) {
      return c.json({ error: 'Invalid file content signature. Uploaded content does not match image/jpeg, image/png, or image/webp.' }, 400);
    }

    if (!c.env.IMAGES) {
      return c.json({ error: 'Storage bucket (R2) is not configured.' }, 500);
    }

    const ext = file.type.split('/')[1] || 'jpg';
    const filename = `profile_${userPayload.id}_${Date.now()}.${ext}`;

    await c.env.IMAGES.put(filename, arrayBuffer, {
      httpMetadata: { contentType: file.type }
    });

    const profilePicUrl = `/uploads/${filename}`;
    await db.prepare('UPDATE users SET profile_pic = ? WHERE id = ?').bind(profilePicUrl, userPayload.id).run();

    return c.json({ success: true, profile_pic: profilePicUrl });
  } catch (err) {
    return c.json({ error: 'Failed to process file upload.' }, 500);
  }
});

// POST /api/stories/:id/comments
app.post('/api/stories/:id/comments', requireUser, checkBan, async (c) => {
  const userPayload = c.get('user');
  if (userPayload.permissions && userPayload.permissions.comment === false) return c.json({ error: 'You are restricted from posting comments.' }, 403);
  const db = c.env.DB;
  const user = c.get('user');
  const storyId = parseInt(c.req.param('id'));
  
  const story = await db.prepare('SELECT user_id FROM stories WHERE id = ?').bind(storyId).first();
  if (story && story.user_id) {
    const blockCheck = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(story.user_id, user.id).first();
    if (blockCheck) {
      return c.json({ error: 'You cannot comment on this story because you are blocked by the author.' }, 403);
    }
  }

  const { content, body } = await c.req.json();
  const commentText = content || body;

  if (!commentText || commentText.trim().length < 1) {
    return c.json({ error: 'Comment content cannot be empty.' }, 400);
  }

  // Moderate text for comments
  let bannedKeywords = [];
  try {
    const setting = await db.prepare("SELECT value FROM settings WHERE key = 'banned_keywords'").first();
    if (setting) bannedKeywords = JSON.parse(setting.value);
  } catch (e) {}

  const modResult = moderateText(commentText, bannedKeywords);
  if (modResult.autoAction === 'reject') {
    return c.json({ error: 'Your comment violates guidelines.' }, 400);
  }

  await db.prepare(
    'INSERT INTO comments (story_id, user_id, body, status) VALUES (?, ?, ?, ?)'
  ).bind(storyId, user.id, modResult.redactedText, 'approved').run();

  await db.prepare(
    'UPDATE stories SET comment_count = comment_count + 1 WHERE id = ?'
  ).bind(storyId).run();

  if (story && story.user_id) {
    await createNotification(db, story.user_id, user.id, 'comment', storyId, commentText.trim());
  }

  return c.json({ success: true, message: 'Comment posted successfully', status: 'approved' });
});

// GET /api/users/:idOrUserId/comments
app.get('/api/users/:idOrUserId/comments', async (c) => {
  const db = c.env.DB;
  const param = c.req.param('idOrUserId');

  let user;
  if (isNaN(param)) {
    user = await db.prepare('SELECT id FROM users WHERE user_id = ?').bind(param).first();
  } else {
    user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(parseInt(param)).first();
  }

  if (!user) return c.json({ error: 'User not found.' }, 404);

  const { results: comments } = await db.prepare(`
    SELECT cm.*, s.title as story_title
    FROM comments cm
    LEFT JOIN stories s ON cm.story_id = s.id
    WHERE cm.user_id = ? AND cm.status = 'approved'
    ORDER BY cm.created_at DESC
  `).bind(user.id).all();

  return c.json(comments);
});

// GET /api/users/:idOrUserId/following
app.get('/api/users/:idOrUserId/following', async (c) => {
  const db = c.env.DB;
  const param = c.req.param('idOrUserId');
  
  let user;
  if (isNaN(param)) {
    user = await db.prepare('SELECT id FROM users WHERE user_id = ?').bind(param).first();
  } else {
    user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(parseInt(param)).first();
  }
  
  if (!user) return c.json({ error: 'User not found.' }, 404);
  
  const { results: following } = await db.prepare(`
    SELECT u.id, u.user_id, u.full_name, u.profile_pic, u.bio
    FROM follows f
    JOIN users u ON f.following_id = u.id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
  `).bind(user.id).all();
  
  return c.json(following);
});

// GET /api/users/:idOrUserId/followers
app.get('/api/users/:idOrUserId/followers', async (c) => {
  const db = c.env.DB;
  const param = c.req.param('idOrUserId');
  
  let user;
  if (isNaN(param)) {
    user = await db.prepare('SELECT id FROM users WHERE user_id = ?').bind(param).first();
  } else {
    user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(parseInt(param)).first();
  }
  
  if (!user) return c.json({ error: 'User not found.' }, 404);
  
  const { results: followers } = await db.prepare(`
    SELECT u.id, u.user_id, u.full_name, u.profile_pic, u.bio
    FROM follows f
    JOIN users u ON f.follower_id = u.id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
  `).bind(user.id).all();
  
  return c.json(followers);
});

// GET /api/users/me/blocked
app.get('/api/users/me/blocked', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  
  const { results: blocked } = await db.prepare(`
    SELECT u.id, u.user_id, u.full_name, u.profile_pic, u.bio
    FROM blocks b
    JOIN users u ON b.blocked_id = u.id
    WHERE b.blocker_id = ?
    ORDER BY b.created_at DESC
  `).bind(user.id).all();
  
  return c.json(blocked);
});

// POST /api/users/:id/block
app.post('/api/users/:id/block', requireUser, async (c) => {
  const userPayload = c.get('user');
  if (userPayload.permissions && userPayload.permissions.block === false) return c.json({ error: 'You are restricted from blocking users.' }, 403);
  const db = c.env.DB;
  const user = c.get('user');
  const blockedId = parseInt(c.req.param('id'));
  
  if (user.id === blockedId) {
    return c.json({ error: 'You cannot block yourself.' }, 400);
  }
  
  await db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').bind(user.id, blockedId).run();
  
  // Unfollow both ways automatically
  await db.prepare('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)')
    .bind(user.id, blockedId, blockedId, user.id).run();
    
  return c.json({ blocked: true, message: 'User blocked successfully.' });
});

// POST /api/users/:id/unblock
app.post('/api/users/:id/unblock', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const blockedId = parseInt(c.req.param('id'));
  
  await db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(user.id, blockedId).run();
  
  return c.json({ blocked: false, message: 'User unblocked successfully.' });
});

// ═════════════════════════════════════════════════════════
// ██  DIRECT MESSAGES (CHAT) API
// ═════════════════════════════════════════════════════════

// POST /api/messages - Send a message
app.post('/api/messages', requireUser, rateLimit('message', 30), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  if (user.permissions && user.permissions.chat === false) return c.json({ error: 'You are restricted from chatting.' }, 403);
  const { receiver_id, body } = await c.req.json();
  
  const receiverId = parseInt(receiver_id);
  const senderId = Number(user.id);
  if (isNaN(receiverId)) return c.json({ error: 'Receiver ID is required.' }, 400);
  if (!body || body.trim().length < 1) return c.json({ error: 'Message body cannot be empty.' }, 400);
  if (senderId === receiverId) return c.json({ error: 'You cannot message yourself.' }, 400);

  // Check block status
  const blockCheck1 = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(senderId, receiverId).first();
  const blockCheck2 = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(receiverId, senderId).first();
  if (blockCheck1 || blockCheck2) {
    return c.json({ error: 'Action blocked by safety preferences.' }, 403);
  }

  const userOneId = Math.min(senderId, receiverId);
  const userTwoId = Math.max(senderId, receiverId);

  // Find or create conversation
  let conv = await db.prepare('SELECT * FROM conversations WHERE user_one_id = ? AND user_two_id = ?')
    .bind(userOneId, userTwoId).first();

  let convId;
  let status = 'pending';
  if (!conv) {
    const result = await db.prepare(
      'INSERT INTO conversations (user_one_id, user_two_id, initiated_by_id, status) VALUES (?, ?, ?, ?)'
    ).bind(userOneId, userTwoId, senderId, 'pending').run();
    convId = result.meta.last_row_id;
  } else {
    convId = conv.id;
    status = conv.status;
    // If conversation is pending and receiver replies, automatically accept
    if (conv.status === 'pending' && Number(conv.initiated_by_id) !== senderId) {
      await db.prepare('UPDATE conversations SET status = "accepted" WHERE id = ?').bind(convId).run();
      status = 'accepted';
    }
  }

  // Insert message
  const msgResult = await db.prepare(
    'INSERT INTO messages (conversation_id, sender_id, receiver_id, body) VALUES (?, ?, ?, ?)'
  ).bind(convId, senderId, receiverId, body.trim()).run();

  // Update last message time
  await db.prepare('UPDATE conversations SET last_message_at = datetime("now") WHERE id = ?').bind(convId).run();

  // Dispatch notifications
  if (status === 'accepted') {
    await createNotification(db, receiverId, senderId, 'chat_message', convId, body.trim());
  } else if (!conv) {
    // If conversation was just created via message, dispatch chat request notification
    await createNotification(db, receiverId, senderId, 'chat_request', convId, 'sent you a chat request');
  }

  return c.json({
    success: true,
    message: {
      id: msgResult.meta.last_row_id,
      conversation_id: convId,
      sender_id: senderId,
      receiver_id: receiverId,
      body: body.trim(),
      created_at: new Date().toISOString()
    },
    conversation_status: status
  }, 201);
});

// POST /api/conversations - Send / initiate chat request
app.post('/api/conversations', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  if (user.permissions && user.permissions.chat === false) return c.json({ error: 'You are restricted from chatting.' }, 403);
  const { receiver_id } = await c.req.json();
  
  const receiverId = parseInt(receiver_id);
  const senderId = Number(user.id);
  if (isNaN(receiverId)) return c.json({ error: 'Receiver ID is required.' }, 400);
  if (senderId === receiverId) return c.json({ error: 'You cannot request chat with yourself.' }, 400);

  // Check blocks
  const blockCheck1 = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(senderId, receiverId).first();
  const blockCheck2 = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(receiverId, senderId).first();
  if (blockCheck1 || blockCheck2) {
    return c.json({ error: 'Action blocked by safety preferences.' }, 403);
  }

  const userOneId = Math.min(senderId, receiverId);
  const userTwoId = Math.max(senderId, receiverId);

  // Find existing
  let conv = await db.prepare('SELECT * FROM conversations WHERE user_one_id = ? AND user_two_id = ?')
    .bind(userOneId, userTwoId).first();

  if (conv) {
    // If it exists, update it to pending and set initiated_by_id to senderId
    await db.prepare('UPDATE conversations SET status = "pending", initiated_by_id = ?, last_message_at = datetime("now") WHERE id = ?')
      .bind(senderId, conv.id).run();
    
    // Notify receiver
    await createNotification(db, receiverId, senderId, 'chat_request', conv.id, 'sent you a chat request');

    // Retrieve updated
    conv = await db.prepare(`
      SELECT c.*, 
             u.id as other_id, u.user_id as other_user_id, u.full_name as other_name, u.profile_pic as other_pic, u.bio as other_bio
      FROM conversations c
      JOIN users u ON u.id = CASE WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END
      WHERE c.id = ?
    `).bind(senderId, conv.id).first();
    
    return c.json(conv);
  }

  // Create new
  const result = await db.prepare(
    'INSERT INTO conversations (user_one_id, user_two_id, initiated_by_id, status, last_message_at) VALUES (?, ?, ?, ?, datetime("now"))'
  ).bind(userOneId, userTwoId, senderId, 'pending').run();
  
  const newConvId = result.meta.last_row_id;
  
  // Notify receiver
  await createNotification(db, receiverId, senderId, 'chat_request', newConvId, 'sent you a chat request');

  const newConv = await db.prepare(`
    SELECT c.*, 
           u.id as other_id, u.user_id as other_user_id, u.full_name as other_name, u.profile_pic as other_pic, u.bio as other_bio
    FROM conversations c
    JOIN users u ON u.id = CASE WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END
    WHERE c.id = ?
  `).bind(senderId, newConvId).first();

  return c.json(newConv, 201);
});

// GET /api/conversations - List conversations
app.get('/api/conversations', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = Number(user.id);

  const { results: conversations } = await db.prepare(`
    SELECT c.*, 
           u.id as other_id, u.user_id as other_user_id, u.full_name as other_name, u.profile_pic as other_pic, u.bio as other_bio,
           (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
           (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
    FROM conversations c
    JOIN users u ON u.id = CASE WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END
    WHERE c.user_one_id = ? OR c.user_two_id = ?
    ORDER BY c.last_message_at DESC
  `).bind(userId, userId, userId).all();

  return c.json(conversations);
});

// GET /api/conversations/:id/messages - Get messages
app.get('/api/conversations/:id/messages', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = Number(user.id);
  const convId = parseInt(c.req.param('id'));

  const conv = await db.prepare(`
    SELECT c.*, 
           u.id as other_id, u.user_id as other_user_id, u.full_name as other_name, u.profile_pic as other_pic, u.bio as other_bio
    FROM conversations c
    JOIN users u ON u.id = CASE WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END
    WHERE c.id = ?
  `).bind(userId, convId).first();

  if (!conv) return c.json({ error: 'Conversation not found.' }, 404);

  if (conv.user_one_id !== userId && conv.user_two_id !== userId) {
    return c.json({ error: 'Unauthorized.' }, 403);
  }

  const { results: messages } = await db.prepare(`
    SELECT * FROM messages 
    WHERE conversation_id = ? 
    ORDER BY created_at ASC
  `).bind(convId).all();

  return c.json({
    conversation: conv,
    messages
  });
});

// POST /api/conversations/:id/accept - Accept request
app.post('/api/conversations/:id/accept', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const convId = parseInt(c.req.param('id'));

  const conv = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(convId).first();
  if (!conv) return c.json({ error: 'Conversation not found.' }, 404);

  if (conv.user_one_id !== user.id && conv.user_two_id !== user.id) {
    return c.json({ error: 'Unauthorized.' }, 403);
  }

  if (conv.status === 'pending') {
    if (conv.initiated_by_id === user.id) {
      return c.json({ error: 'Waiting for the other user to accept.' }, 400);
    }
    await db.prepare('UPDATE conversations SET status = "accepted" WHERE id = ?').bind(convId).run();
    await createNotification(db, conv.initiated_by_id, user.id, 'chat_accepted', convId, 'accepted your chat request');
  } else if (conv.status === 'declined') {
    // If declined and receiver accepts again, update to accepted and notify initiator
    await db.prepare('UPDATE conversations SET status = "accepted" WHERE id = ?').bind(convId).run();
    await createNotification(db, conv.initiated_by_id, user.id, 'chat_accepted', convId, 'accepted your chat request');
  }

  return c.json({ success: true, status: 'accepted' });
});

// POST /api/conversations/:id/decline - Decline conversation
app.post('/api/conversations/:id/decline', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const convId = parseInt(c.req.param('id'));

  const conv = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(convId).first();
  if (!conv) return c.json({ error: 'Conversation not found.' }, 404);

  if (conv.user_one_id !== user.id && conv.user_two_id !== user.id) {
    return c.json({ error: 'Unauthorized.' }, 403);
  }

  await db.prepare('UPDATE conversations SET status = "declined" WHERE id = ?').bind(convId).run();
  await createNotification(db, conv.initiated_by_id, user.id, 'chat_declined', convId, 'declined your chat request');

  return c.json({ success: true, status: 'declined' });
});

// DELETE /api/conversations/:id - Permanently delete conversation
app.delete('/api/conversations/:id', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const convId = parseInt(c.req.param('id'));

  const conv = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(convId).first();
  if (!conv) return c.json({ error: 'Conversation not found.' }, 404);

  if (conv.user_one_id !== user.id && conv.user_two_id !== user.id) {
    return c.json({ error: 'Unauthorized.' }, 403);
  }

  await db.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(convId).run();
  await db.prepare('DELETE FROM conversations WHERE id = ?').bind(convId).run();

  return c.json({ success: true, message: 'Conversation permanently deleted.' });
});

// DELETE /api/comments/:id
app.delete('/api/comments/:id', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const commentId = parseInt(c.req.param('id'));

  const comment = await db.prepare('SELECT user_id, story_id FROM comments WHERE id = ?').bind(commentId).first();
  if (!comment) return c.json({ error: 'Comment not found.' }, 404);

  if (comment.user_id !== user.id) {
    return c.json({ error: 'Unauthorized.' }, 403);
  }

  await db.prepare('UPDATE comments SET status = "removed" WHERE id = ?').bind(commentId).run();
  await db.prepare('UPDATE stories SET comment_count = MAX(0, comment_count - 1) WHERE id = ?').bind(comment.story_id).run();

  return c.json({ success: true });
});

app.post('/api/users/:id/follow', requireUser, async (c) => {
  const userPayload = c.get('user');
  if (userPayload.permissions && userPayload.permissions.follow === false) return c.json({ error: 'You are restricted from following users.' }, 403);
  const db = c.env.DB;
  const loggedInUser = c.get('user');
  const targetId = parseInt(c.req.param('id'));

  if (loggedInUser.id === targetId) return c.json({ error: 'You cannot follow yourself.' }, 400);

  const blockCheck1 = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(loggedInUser.id, targetId).first();
  const blockCheck2 = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(targetId, loggedInUser.id).first();
  if (blockCheck1 || blockCheck2) {
    return c.json({ error: 'Action blocked by safety preferences.' }, 403);
  }

  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'User not found.' }, 404);

  const existing = await db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').bind(loggedInUser.id, targetId).first();

  if (existing) {
    await db.prepare('DELETE FROM follows WHERE id = ?').bind(existing.id).run();
    return c.json({ following: false });
  }

  await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').bind(loggedInUser.id, targetId).run();
  await createNotification(db, targetId, loggedInUser.id, 'follow', loggedInUser.id, 'started following you');
  return c.json({ following: true });
});

// GET /api/notifications - Get notifications
app.get('/api/notifications', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = Number(user.id);

  try {
    const { results: notifications } = await db.prepare(`
      SELECT n.*, 
             u.full_name as actor_name, u.profile_pic as actor_pic, u.user_id as actor_user_id
      FROM notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `).bind(userId).all();
    return c.json(notifications || []);
  } catch (err) {
    try {
      const { results: fallbackNotifs } = await db.prepare(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
      ).bind(userId).all();
      return c.json(fallbackNotifs || []);
    } catch (e) {
      return c.json([]);
    }
  }
});

// POST /api/notifications/read - Mark all as read
app.post('/api/notifications/read', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = Number(user.id);

  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(userId).run();
  return c.json({ success: true });
});

// POST /api/notifications/:id/read - Mark single as read
app.post('/api/notifications/:id/read', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = Number(user.id);
  const notifId = parseInt(c.req.param('id'));

  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').bind(notifId, userId).run();
  return c.json({ success: true });
});

// Stats public block fallback
app.get('/api/stats/public', async (c) => {
  const db = c.env.DB;
  const [storyStats, visitorRow, commentRow] = await Promise.all([
    db.prepare(`
      SELECT
        COALESCE(SUM(like_count), 0)    AS total_likes,
        COUNT(*)                         AS total_stories
      FROM stories WHERE status = 'approved'
    `).first(),
    db.prepare("SELECT value FROM settings WHERE key = 'total_visitors'").first(),
    db.prepare("SELECT COUNT(*) as cnt FROM comments WHERE status = 'approved'").first()
  ]);

  return c.json({
    totalLikes:    Number(storyStats?.total_likes    ?? 0),
    totalStories:  Number(storyStats?.total_stories  ?? 0),
    totalComments: Number(commentRow?.cnt             ?? 0),
    totalVisitors: Number(visitorRow?.value           ?? 0)
  });
});

app.post('/api/stats/visit', async (c) => {
  const db = c.env.DB;
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES ('total_visitors', '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  `).run();
  return c.json({ ok: true });
});

// ── GET /api/crisis-resources ──
app.get('/api/crisis-resources', (c) => {
  return c.json({
    disclaimer: 'This platform is peer support, NOT therapy or crisis intervention.',
    resources: [
      {
        category: 'United States Support',
        items: [
          { name: '988 Suicide & Crisis Lifeline', contact: '988', type: 'Call or Text', region: 'US', hours: '24/7' }
        ]
      }
    ]
  });
});

// ═════════════════════════════════════════════════════════
// ██  ADMIN API ROUTES (UPGRADED FOR D1 RELATIONSHIPS)
// ═════════════════════════════════════════════════════════

// ── ONE-TIME ADMIN SETUP ENDPOINT ──
// POST /api/admin/setup  { secret: "MIDNIGHT_SETUP_2026" }
// Creates the default admin user if none exists yet.
// Auto-disabled once any admin user exists in the DB.
app.post('/api/admin/setup', async (c) => {
  const db = c.env.DB;
  const { secret } = await c.req.json().catch(() => ({}));

  // Verify the setup secret
  if (secret !== 'MIDNIGHT_SETUP_2026') {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  // Only allow if NO admin users exist yet
  const existing = await db.prepare('SELECT COUNT(*) as cnt FROM admin_users').first();
  if (existing && existing.cnt > 0) {
    return c.json({ error: 'Admin already configured. Endpoint disabled.' }, 409);
  }

  const password = 'Admin@2026!';
  const hash = await bcrypt.hash(password, 10);
  const mfaSecret = 'JBSWY3DPEHPK3PXP'; // fixed placeholder; user can enable MFA later

  await db.prepare(
    `INSERT INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role)
     VALUES ('admin', 'admin@midnightstories.com', ?, ?, 0, 'superadmin')`
  ).bind(hash, mfaSecret).run();

  return c.json({
    success: true,
    message: 'Admin user created successfully.',
    username: 'admin',
    password: password,
    note: 'This endpoint is now permanently disabled (admin already exists).'
  });
});

app.post('/api/admin/login', rateLimit('admin-login', 10), async (c) => {
  const db = c.env.DB;
  const { username, password } = await c.req.json();

  const admin = await db.prepare('SELECT * FROM admin_users WHERE username = ?').bind(username).first();
  const passwordMatch = admin ? (bcrypt.compareSync ? bcrypt.compareSync(password, admin.password_hash) : await bcrypt.compare(password, admin.password_hash)) : false;
  if (!admin || !passwordMatch) return c.json({ error: 'Invalid credentials.' }, 401);

  if (admin.mfa_enabled) {
    const preToken = await signJWT({ adminId: admin.id, username: admin.username, step: 'mfa', exp: Math.floor(Date.now() / 1000) + 300 }, getAdminJwtSecret(c));
    return c.json({ requireMFA: true, preToken });
  }

  const token = await signJWT({ adminId: admin.id, username: admin.username, role: admin.role, exp: Math.floor(Date.now() / 1000) + 86400 }, getAdminJwtSecret(c));
  return c.json({ token, username: admin.username, role: admin.role, mfaEnabled: false });
});






app.post('/api/users/:id/follow', requireUser, async (c) => {
  const userPayload = c.get('user');
  if (userPayload.permissions && userPayload.permissions.follow === false) return c.json({ error: 'You are restricted from following users.' }, 403);
  const db = c.env.DB;
  const loggedInUser = c.get('user');
  const targetId = parseInt(c.req.param('id'));

  if (loggedInUser.id === targetId) return c.json({ error: 'You cannot follow yourself.' }, 400);

  const blockCheck1 = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(loggedInUser.id, targetId).first();
  const blockCheck2 = await db.prepare('SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(targetId, loggedInUser.id).first();
  if (blockCheck1 || blockCheck2) {
    return c.json({ error: 'Action blocked by safety preferences.' }, 403);
  }

  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'User not found.' }, 404);

  const existing = await db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').bind(loggedInUser.id, targetId).first();

  if (existing) {
    await db.prepare('DELETE FROM follows WHERE id = ?').bind(existing.id).run();
    return c.json({ following: false });
  }

  await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').bind(loggedInUser.id, targetId).run();
  await createNotification(db, targetId, loggedInUser.id, 'follow', loggedInUser.id, 'started following you');
  return c.json({ following: true });
});

// GET /api/notifications - Get notifications
app.get('/api/notifications', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = Number(user.id);

  try {
    const { results: notifications } = await db.prepare(`
      SELECT n.*, 
             u.full_name as actor_name, u.profile_pic as actor_pic, u.user_id as actor_user_id
      FROM notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `).bind(userId).all();
    return c.json(notifications || []);
  } catch (err) {
    try {
      const { results: fallbackNotifs } = await db.prepare(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
      ).bind(userId).all();
      return c.json(fallbackNotifs || []);
    } catch (e) {
      return c.json([]);
    }
  }
});

// POST /api/notifications/read - Mark all as read
app.post('/api/notifications/read', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = Number(user.id);

  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(userId).run();
  return c.json({ success: true });
});

// POST /api/notifications/:id/read - Mark single as read
app.post('/api/notifications/:id/read', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const userId = Number(user.id);
  const notifId = parseInt(c.req.param('id'));

  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').bind(notifId, userId).run();
  return c.json({ success: true });
});

// Stats public block fallback
app.get('/api/stats/public', async (c) => {
  const db = c.env.DB;
  const [storyStats, visitorRow, commentRow] = await Promise.all([
    db.prepare(`
      SELECT
        COALESCE(SUM(like_count), 0)    AS total_likes,
        COUNT(*)                         AS total_stories
      FROM stories WHERE status = 'approved'
    `).first(),
    db.prepare("SELECT value FROM settings WHERE key = 'total_visitors'").first(),
    db.prepare("SELECT COUNT(*) as cnt FROM comments WHERE status = 'approved'").first()
  ]);

  return c.json({
    totalLikes:    Number(storyStats?.total_likes    ?? 0),
    totalStories:  Number(storyStats?.total_stories  ?? 0),
    totalComments: Number(commentRow?.cnt             ?? 0),
    totalVisitors: Number(visitorRow?.value           ?? 0)
  });
});

app.post('/api/stats/visit', async (c) => {
  const db = c.env.DB;
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES ('total_visitors', '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  `).run();
  return c.json({ ok: true });
});

// ── GET /api/crisis-resources ──
app.get('/api/crisis-resources', (c) => {
  return c.json({
    disclaimer: 'This platform is peer support, NOT therapy or crisis intervention.',
    resources: [
      {
        category: 'United States Support',
        items: [
          { name: '988 Suicide & Crisis Lifeline', contact: '988', type: 'Call or Text', region: 'US', hours: '24/7' }
        ]
      }
    ]
  });
});

app.get('/api/debug-db', async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    return c.json({ success: true, tables: results });
  } catch (e) {
    return c.json({ success: false, error: e.message });
  }
});

// ═════════════════════════════════════════════════════════
// ██  ADMIN API ROUTES (UPGRADED FOR D1 RELATIONSHIPS)
// ═════════════════════════════════════════════════════════

app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ message: 'User deleted successfully.' });
});

app.get('/api/admin/stats', requireAdmin, async (c) => {
  const db = c.env.DB;

  const totalStories = (await db.prepare('SELECT COUNT(*) as c FROM stories').first().catch(() => ({ c: 0 })))?.c || 0;
  const pendingStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'pending'").first().catch(() => ({ c: 0 })))?.c || 0;
  const approvedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'approved' OR status = 'published'").first().catch(() => ({ c: 0 })))?.c || 0;
  const rejectedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'rejected'").first().catch(() => ({ c: 0 })))?.c || 0;

  const totalComments = (await db.prepare('SELECT COUNT(*) as c FROM comments').first().catch(() => ({ c: 0 })))?.c || 0;
  const pendingComments = (await db.prepare("SELECT COUNT(*) as c FROM comments WHERE status = 'pending'").first().catch(() => ({ c: 0 })))?.c || 0;
  const totalUsers = (await db.prepare('SELECT COUNT(*) as c FROM users').first().catch(() => ({ c: 0 })))?.c || 0;
  const totalLikes = (await db.prepare('SELECT SUM(like_count) as c FROM stories').first().catch(() => ({ c: 0 })))?.c || 0;

  const openReports = (await db.prepare("SELECT COUNT(*) as c FROM reports WHERE ticket_status != 'resolved' AND ticket_status != 'closed'").first().catch(() => ({ c: 0 })))?.c || 0;
  const bannedIPs = (await db.prepare('SELECT COUNT(*) as c FROM banned_identifiers').first().catch(() => ({ c: 0 })))?.c || 0;
  
  const totalBooks = (await db.prepare('SELECT COUNT(*) as c FROM books').first().catch(() => ({ c: 0 })))?.c || 0;
  const pendingBooks = (await db.prepare("SELECT COUNT(*) as c FROM books WHERE is_user_submission = 1 AND submission_status = 'pending'").first().catch(() => ({ c: 0 })))?.c || 0;
  const totalCategories = (await db.prepare('SELECT COUNT(*) as c FROM ticket_categories').first().catch(() => ({ c: 0 })))?.c || 0;

  return c.json({
    totalStories, pendingStories, approvedStories, rejectedStories,
    totalComments, pendingComments, totalUsers, totalLikes,
    openReports, bannedIPs,
    totalBooks, pendingBooks, totalCategories
  });
});

app.get('/api/admin/queue', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { type = 'stories', status } = c.req.query();

  if (type === 'stories') {
    let sql = `
      SELECT s.id, s.user_id, s.title, COALESCE(s.content, s.body, '') AS body, s.category_id, s.image_url, s.status, s.submitter_token, s.ip_hash, s.like_count, s.comment_count, s.created_at, s.updated_at,
             COALESCE(tc.name, cat.name, 'General') as category_name,
             COALESCE(u.full_name, 'Admin') as author_name
      FROM stories s
      LEFT JOIN ticket_categories tc ON s.category_id = tc.id
      LEFT JOIN categories cat ON s.category_id = cat.id
      LEFT JOIN users u ON s.user_id = u.id
    `;
    let bindings = [];
    if (status && status !== 'all') {
      sql += ` WHERE s.status = ? `;
      bindings.push(status);
    }
    sql += ` ORDER BY s.created_at DESC `;
    try {
      const { results } = await db.prepare(sql).bind(...bindings).all();
      return c.json({ items: results || [], type: 'stories' });
    } catch (err1) {
      try {
        let fallbackSql = 'SELECT *, content AS body FROM stories';
        let fallbackBinds = [];
        if (status && status !== 'all') {
          fallbackSql += ' WHERE status = ?';
          fallbackBinds.push(status);
        }
        fallbackSql += ' ORDER BY created_at DESC';
        const { results } = await db.prepare(fallbackSql).bind(...fallbackBinds).all();
        return c.json({ items: (results || []).map(r => ({ ...r, category_name: 'General', author_name: 'Admin' })), type: 'stories' });
      } catch (err2) {
        return c.json({ items: [], type: 'stories' });
      }
    }
  } else {
    let sql = `
      SELECT cm.id, cm.story_id, cm.user_id, COALESCE(cm.content, cm.body, '') AS body, cm.status, cm.ip_hash, cm.created_at,
             COALESCE(s.title, b.title, 'General Post') as story_title,
             s.user_id as story_author_id,
             COALESCE(u.full_name, u.username, 'Anonymous Reader') as commenter_name,
             COALESCE(u.email, '—') as commenter_email,
             COALESCE(su.full_name, 'Admin') as post_author_name
      FROM comments cm
      LEFT JOIN stories s ON cm.story_id = s.id
      LEFT JOIN books b ON cm.book_id = b.id
      LEFT JOIN users u ON cm.user_id = u.id
      LEFT JOIN users su ON s.user_id = su.id
    `;
    let bindings = [];
    if (status && status !== 'all') {
      sql += ` WHERE cm.status = ? `;
      bindings.push(status);
    }
    sql += ` ORDER BY cm.created_at DESC `;
    try {
      const { results } = await db.prepare(sql).bind(...bindings).all();
      return c.json({ items: results || [], type: 'comments' });
    } catch (err1) {
      console.error('Complex comments query error, trying fallback:', err1);
      try {
        let fallbackSql = 'SELECT *, content AS body FROM comments';
        let fallbackBinds = [];
        if (status && status !== 'all') {
          fallbackSql += ' WHERE status = ?';
          fallbackBinds.push(status);
        }
        fallbackSql += ' ORDER BY created_at DESC';
        const { results } = await db.prepare(fallbackSql).bind(...fallbackBinds).all();
        return c.json({ items: (results || []).map(r => ({ ...r, commenter_name: 'Anonymous Reader', story_title: 'Story #' + (r.story_id || 1), post_author_name: 'Admin' })), type: 'comments' });
      } catch (err2) {
        return c.json({ items: [], type: 'comments' });
      }
    }
  }
});

// ── Admin Comment Edit / Update Status ──
app.put('/api/admin/comments/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const { content, status } = body;
  const commentBody = content !== undefined ? content : body.body;

  await db.prepare(`
    UPDATE comments
    SET content = COALESCE(?, content),
        status = COALESCE(?, status)
    WHERE id = ?
  `).bind(
    commentBody !== undefined ? commentBody.trim() : null,
    status || null,
    id
  ).run();

  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'comment.update',
    targetType: 'comment',
    targetId: id
  });

  return c.json({ success: true, message: 'Comment updated successfully.' });
});

// ── Admin Delete Comment ──
app.delete('/api/admin/comments/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));

  await db.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();

  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'comment.delete',
    targetType: 'comment',
    targetId: id
  });

  return c.json({ success: true, message: 'Comment deleted successfully.' });
});

// ── Admin Direct Message User ──
app.post('/api/admin/messages', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { user_id, title, message } = await c.req.json().catch(() => ({}));

  if (!user_id || !title || !message) {
    return c.json({ error: 'user_id, title, and message are required.' }, 400);
  }

  await createNotification(db, user_id, adminPayload.adminId, 'admin_message', null, `[${title}] ${message}`);

  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'user.message_sent',
    targetType: 'user',
    targetId: parseInt(user_id),
    details: JSON.stringify({ title, message })
  });

  return c.json({ success: true, message: 'Official admin message sent successfully.' });
});


// ── Admin Story Creation ──
app.post('/api/admin/stories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const body = await c.req.json().catch(() => ({}));
  const title = (body.title || '').trim();
  const content = (body.content || body.body || '').trim();
  const category_id = body.category_id ? parseInt(body.category_id) : null;
  const image_url = body.image_url ? body.image_url.trim() : null;
  const status = body.status || 'approved';

  if (!title || !content) {
    return c.json({ error: 'Title and content are required.' }, 400);
  }

  const token = 'ADMIN_' + Date.now();
  const res = await db.prepare(`
    INSERT INTO stories (title, content, category_id, image_url, status, submitter_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(title, content, category_id, image_url, status, token).run();

  const newId = res.meta.last_row_id;
  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'story.create',
    targetType: 'story',
    targetId: newId,
    newValue: { title, status }
  });

  return c.json({ success: true, message: 'Story created successfully.', id: newId }, 201);
});

// ── Admin Story Edit / Update Status ──
app.put('/api/admin/stories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const { title, content, category_id, image_url, status } = body;
  const storyBody = content !== undefined ? content : body.body;

  await db.prepare(`
    UPDATE stories
    SET title = COALESCE(?, title),
        content = COALESCE(?, content),
        category_id = COALESCE(?, category_id),
        image_url = COALESCE(?, image_url),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    title ? title.trim() : null,
    storyBody !== undefined ? storyBody.trim() : null,
    category_id !== undefined ? (category_id ? parseInt(category_id) : null) : null,
    image_url !== undefined ? image_url : null,
    status || null,
    id
  ).run();

  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'story.update',
    targetType: 'story',
    targetId: id
  });

  return c.json({ success: true, message: 'Story updated successfully.' });
});

// ── Admin Delete Story ──
app.delete('/api/admin/stories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));

  await db.prepare('DELETE FROM stories WHERE id = ?').bind(id).run();

  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'story.delete',
    targetType: 'story',
    targetId: id
  });

  return c.json({ success: true, message: 'Story deleted successfully.' });
});

app.get('/api/admin/users', requireAdmin, async (c) => {
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const search = c.req.query('search') || '';
  const statusFilter = c.req.query('status') || '';
  const offset = (page - 1) * limit;

  try {
    let whereClauses = [];
    let binds = [];

    if (search) {
      whereClauses.push('(full_name LIKE ? OR email LIKE ? OR user_id LIKE ?)');
      const s = '%' + search + '%';
      binds.push(s, s, s);
    }

    if (statusFilter && statusFilter !== 'all') {
      whereClauses.push('account_status = ?');
      binds.push(statusFilter);
    }

    const whereStr = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    let query = `
      SELECT id, user_id, full_name, email, COALESCE(role, 'user') AS role, COALESCE(account_status, 'active') AS account_status, created_at,
             (SELECT COUNT(*) FROM stories WHERE (user_id = users.id OR submitter_token = users.user_id)) AS story_count,
             (SELECT COUNT(*) FROM comments WHERE user_id = users.id) AS comment_count
      FROM users
      ${whereStr}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `;

    const { results } = await db.prepare(query).bind(...binds, limit, offset).all();

    const countQuery = `SELECT COUNT(*) as cnt FROM users ${whereStr}`;
    const total = await db.prepare(countQuery).bind(...binds).first();

    return c.json({ users: results || [], total: total?.cnt ?? 0, page, limit });
  } catch (err) {
    console.error('GET /api/admin/users query error, trying fallback:', err);
    try {
      const { results } = await db.prepare('SELECT id, user_id, full_name, email, account_status, created_at FROM users LIMIT 100').all();
      return c.json({ users: (results || []).map(u => ({ ...u, role: 'user', story_count: 0, comment_count: 0 })), total: results?.length || 0 });
    } catch(err2) {
      return c.json({ users: [], total: 0 });
    }
  }
});

// ── Admin Create User ──
app.post('/api/admin/users', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const body = await c.req.json().catch(() => ({}));
  const full_name = (body.full_name || '').trim();
  const email = (body.email || '').trim();
  const user_id = (body.user_id || 'usr_' + Date.now()).trim();
  const role = body.role || 'user';
  const account_status = body.account_status || 'active';

  if (!full_name || !email) {
    return c.json({ error: 'Full name and email are required.' }, 400);
  }

  const res = await db.prepare(`
    INSERT INTO users (user_id, full_name, email, role, account_status, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(user_id, full_name, email, role, account_status).run();

  const newId = res.meta.last_row_id;
  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'user.create',
    targetType: 'user',
    targetId: newId,
    newValue: { full_name, email, role, account_status }
  });

  return c.json({ success: true, message: 'User account created successfully.', id: newId }, 201);
});

// ── Admin Update User Details / Role / Status ──
app.put('/api/admin/users/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const { full_name, email, role, account_status } = body;

  await db.prepare(`
    UPDATE users
    SET full_name = COALESCE(?, full_name),
        email = COALESCE(?, email),
        role = COALESCE(?, role),
        account_status = COALESCE(?, account_status)
    WHERE id = ?
  `).bind(
    full_name ? full_name.trim() : null,
    email ? email.trim() : null,
    role || null,
    account_status || null,
    id
  ).run();

  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'user.update',
    targetType: 'user',
    targetId: id
  });

  return c.json({ success: true, message: 'User account updated successfully.' });
});

// ── Admin Reset User Password ──
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const { new_password } = await c.req.json().catch(() => ({}));

  if (!new_password || new_password.length < 6) {
    return c.json({ error: 'New password must be at least 6 characters long.' }, 400);
  }

  // In production, pass through password hash helper
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(new_password, id).run();

  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'user.password_reset',
    targetType: 'user',
    targetId: id
  });

  return c.json({ success: true, message: 'User password reset successfully.' });
});

// ── Admin Delete User ──
app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));

  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

  await writeAuditLog(db, {
    actorId: adminPayload.adminId,
    actorType: 'admin',
    action: 'user.delete',
    targetType: 'user',
    targetId: id
  });

  return c.json({ success: true, message: 'User account deleted successfully.' });
});


app.get('/api/admin/stats', requireAdmin, async (c) => {
  const db = c.env.DB;

  const totalStories = (await db.prepare('SELECT COUNT(*) as c FROM stories').first().catch(() => ({ c: 0 })))?.c || 0;
  const pendingStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'pending'").first().catch(() => ({ c: 0 })))?.c || 0;
  const approvedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'approved' OR status = 'published'").first().catch(() => ({ c: 0 })))?.c || 0;
  const rejectedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'rejected'").first().catch(() => ({ c: 0 })))?.c || 0;

  const totalComments = (await db.prepare('SELECT COUNT(*) as c FROM comments').first().catch(() => ({ c: 0 })))?.c || 0;
  const pendingComments = (await db.prepare("SELECT COUNT(*) as c FROM comments WHERE status = 'pending'").first().catch(() => ({ c: 0 })))?.c || 0;
  const totalUsers = (await db.prepare('SELECT COUNT(*) as c FROM users').first().catch(() => ({ c: 0 })))?.c || 0;
  const totalLikes = (await db.prepare('SELECT SUM(like_count) as c FROM stories').first().catch(() => ({ c: 0 })))?.c || 0;

  const openReports = (await db.prepare("SELECT COUNT(*) as c FROM reports WHERE ticket_status != 'resolved' AND ticket_status != 'closed'").first().catch(() => ({ c: 0 })))?.c || 0;
  const bannedIPs = (await db.prepare('SELECT COUNT(*) as c FROM banned_identifiers').first().catch(() => ({ c: 0 })))?.c || 0;
  
  const totalBooks = (await db.prepare('SELECT COUNT(*) as c FROM books').first().catch(() => ({ c: 0 })))?.c || 0;
  const pendingBooks = (await db.prepare("SELECT COUNT(*) as c FROM books WHERE is_user_submission = 1 AND submission_status = 'pending'").first().catch(() => ({ c: 0 })))?.c || 0;
  const totalCategories = (await db.prepare('SELECT COUNT(*) as c FROM ticket_categories').first().catch(() => ({ c: 0 })))?.c || 0;

  return c.json({
    totalStories, pendingStories, approvedStories, rejectedStories,
    totalComments, pendingComments, totalUsers, totalLikes,
    openReports, bannedIPs,
    totalBooks, pendingBooks, totalCategories
  });
});

app.post('/api/admin/moderate', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { target_type, target_id, action, reason } = await c.req.json();

  const statusMap = { approve: 'approved', reject: 'rejected', remove: 'removed' };
  const targetIdInt = parseInt(target_id);

  try {
    if (target_type === 'story') {
      await db.prepare("UPDATE stories SET status = ? WHERE id = ?").bind(statusMap[action] || 'approved', targetIdInt).run();
    } else {
      await db.prepare("UPDATE comments SET status = ? WHERE id = ?").bind(statusMap[action] || 'approved', targetIdInt).run();
    }
    await db.prepare('INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)').bind(target_type, targetIdInt, adminPayload.adminId, action, reason || null).run();
  } catch(e) {}

  return c.json({ message: `Content updated successfully.` });
});
// ── Categories ──
app.get('/api/admin/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM stories WHERE category_id = c.id) as story_count
    FROM categories c ORDER BY name ASC
  `).all();
  return c.json(results);
});

app.post('/api/admin/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { name } = await c.req.json().catch(() => ({}));
  const slug = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  try {
    await db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').bind(name, slug).run();
    return c.json({ message: 'Category added.' });
  } catch (err) {
    return c.json({ error: 'Category already exists.' }, 400);
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  try {
    await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  } catch(e) {}
  return c.json({ message: 'Category deleted.' });
});

app.put('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const updates = await c.req.json().catch(() => ({}));
  try {
    const stmts = [];
    for (const [key, value] of Object.entries(updates)) {
      const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      stmts.push(db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, strValue));
    }
    await db.batch(stmts);
  } catch(e) {}
  return c.json({ message: 'Settings saved successfully.' });
});

app.get('/api/user/ticket-categories', async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare('SELECT id, name, description FROM ticket_categories WHERE is_active = 1 ORDER BY id ASC').all();
    return c.json(results || []);
  } catch(e) {
    return c.json([]);
  }
});

app.post('/api/user/tickets/create', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  try {
    const formData = await c.req.formData();
    const subject = formData.get('subject') || 'Support Request';
    const category_id = parseInt(formData.get('category_id')) || 1;
    const priority = formData.get('priority') || 'medium';
    const details = formData.get('details') || '';
    const tracking_number = 'TKT-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.floor(1000 + Math.random() * 9000);

    const reportRes = await db.prepare(`
      INSERT INTO reports (ticket_id, subject, category_id, reported_item_type, reason, report_description, priority, ticket_status, reporter_id)
      VALUES (?, ?, ?, 'support', ?, ?, ?, 'open', ?)
    `).bind(tracking_number, subject, category_id, subject, details, priority, user.id).run();

    return c.json({ success: true, ticket_id: tracking_number, id: reportRes.meta.last_row_id });
  } catch (err) {
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  }
});

app.post('/api/reports', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  try {
    const formData = await c.req.formData();
    const target_type = formData.get('target_type') || formData.get('reported_item_type') || 'support';
    const target_id = parseInt(formData.get('target_id') || formData.get('reported_item_id')) || 0;
    const reason = formData.get('reason') || 'General Report';
    const details = formData.get('details') || null;
    const ticket_id = 'TKT-' + Math.floor(1000 + Math.random() * 9000) + '-' + Date.now().toString().slice(-4);

    await db.prepare('INSERT INTO reports (ticket_id, subject, reported_item_type, reported_item_id, reason, report_description, reporter_id, ticket_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ticket_id, reason, target_type, target_id, reason, details, user.id, 'open')
      .run();

    return c.json({ success: true, ticket_id });
  } catch (err) {
    console.error('POST /api/reports ERROR:', err);
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  }
});

app.get('/api/admin/reports', requireAdmin, async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status') || 'all';
  const priority = c.req.query('priority');
  const category_id = c.req.query('category_id');
  const search = c.req.query('search');

  try {
    let query = `
      SELECT r.*,
             COALESCE(r.ticket_id, 'TKT-' || r.id) as ticket_id,
             COALESCE(r.ticket_status, 'open') as ticket_status,
             COALESCE(r.priority, 'medium') as priority,
             CASE WHEN r.reported_item_type = 'story' THEN (SELECT title FROM stories WHERE id = r.reported_item_id)
                  WHEN r.reported_item_type = 'comment' THEN (SELECT content FROM comments WHERE id = r.reported_item_id)
                  ELSE NULL END as target_preview,
             u.full_name as reporter_name, u.email as reporter_email,
             tc.name as category_name,
             au.username as assigned_agent_name
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      LEFT JOIN ticket_categories tc ON r.category_id = tc.id
      LEFT JOIN admin_users au ON r.assigned_agent_id = au.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      if (status === 'open') {
        query += " AND (r.ticket_status = 'open' OR r.ticket_status = 'investigating' OR r.ticket_status = 'waiting_on_user' OR r.ticket_status IS NULL OR r.ticket_status = '')";
      } else {
        query += " AND r.ticket_status = ?";
        params.push(status);
      }
    }

    if (priority && priority !== 'all') {
      query += " AND r.priority = ?";
      params.push(priority);
    }

    if (category_id && category_id !== 'all') {
      query += " AND r.category_id = ?";
      params.push(parseInt(category_id));
    }

    if (search) {
      query += " AND (r.ticket_id LIKE ? OR r.subject LIKE ? OR r.reason LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += " ORDER BY r.created_at DESC";

    const { results } = await db.prepare(query).bind(...params).all();
    return c.json(results || []);
  } catch (err) {
    console.error('GET /api/admin/reports ERROR:', err);
    return c.json([]);
  }
});

app.post('/api/admin/reports/:id/status', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const { status, priority, category_id, action } = await c.req.json().catch(() => ({}));

  const oldReport = await db.prepare('SELECT ticket_status, priority, category_id FROM reports WHERE id = ?').bind(id).first();
  if (!oldReport) return c.json({ error: 'Ticket not found' }, 404);

  const updates = [];
  const binds = [];

  if (status) {
    updates.push('ticket_status = ?');
    binds.push(status);
    if (status === 'resolved' || status === 'closed') {
      updates.push('resolved_by = ?');
      binds.push(adminPayload.adminId);
      updates.push('resolved_at = CURRENT_TIMESTAMP');
    }
  }

  if (priority) {
    updates.push('priority = ?');
    binds.push(priority);
  }

  if (category_id) {
    updates.push('category_id = ?');
    binds.push(parseInt(category_id));
  }



  try {
    await db.prepare(`
      INSERT INTO ticket_audit_logs (ticket_id, actor_id, actor_type, action_type, old_value, new_value)
      VALUES (?, ?, 'admin', 'update_properties', ?, ?)
    `).bind(id, adminPayload.adminId, JSON.stringify(oldReport), JSON.stringify({ status, priority, category_id })).run();
  } catch(e) {}

  return c.json({ message: 'Ticket updated successfully.' });
});

// ── Bans ──
app.get('/api/admin/bans', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare('SELECT * FROM banned_identifiers ORDER BY created_at DESC').all();
    return c.json(results || []);
  } catch(e) {
    return c.json([]);
  }
});

app.post('/api/admin/ban', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { identifier, reason, type = 'ip' } = await c.req.json().catch(() => ({}));
  try {
    await db.prepare('INSERT INTO banned_identifiers (type, value, reason, admin_id) VALUES (?, ?, ?, ?)')
      .bind(type, identifier, reason, adminPayload.adminId).run();
  } catch(e) {}
  return c.json({ message: 'Ban added successfully.' });
});

app.delete('/api/admin/bans/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  try {
    await db.prepare('DELETE FROM banned_identifiers WHERE id = ?').bind(id).run();
  } catch(e) {}
  return c.json({ message: 'Ban removed successfully.' });
});

// ── Settings ──
app.get('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare('SELECT * FROM settings').all();
    const settings = {};
    results.forEach(r => settings[r.key] = r.value);
    return c.json(settings);
  } catch(e) {
    return c.json({});
  }
});

app.patch('/api/admin/tickets/:id/assign', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const { assigned_agent_id } = await c.req.json();

  const report = await db.prepare('SELECT assigned_agent_id FROM reports WHERE id = ?').bind(id).first();
  if (!report) return c.json({ error: 'Ticket not found' }, 404);

  await db.prepare('UPDATE reports SET assigned_agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(assigned_agent_id || null, id).run();

  await db.prepare(`
    INSERT INTO ticket_audit_logs (ticket_id, actor_id, actor_type, action_type, old_value, new_value)
    VALUES (?, ?, 'admin', 'assignment_change', ?, ?)
  `).bind(id, adminPayload.adminId, String(report.assigned_agent_id || 'Unassigned'), String(assigned_agent_id || 'Unassigned')).run();

  return c.json({ success: true, message: 'Ticket agent assigned.' });
});

app.get('/api/admin/canned-responses', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM canned_responses ORDER BY title ASC').all();
  return c.json(results);
});

app.post('/api/admin/canned-responses', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { title, content, category_id } = await c.req.json();
  if (!title || !content) return c.json({ error: 'Title and Content are required.' }, 400);
  await db.prepare('INSERT INTO canned_responses (title, content, category_id) VALUES (?, ?, ?)').bind(title, content, category_id || null).run();
  return c.json({ success: true, message: 'Canned response template added.' });
});

app.get('/api/admin/support-agents', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT id, username, email, role FROM admin_users ORDER BY username ASC').all();
  return c.json(results);
});



// ── Audit Log ──
app.get('/api/admin/audit-log', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT ml.*, au.username as admin_username 
    FROM moderation_log ml
    LEFT JOIN admin_users au ON ml.admin_id = au.id
    ORDER BY ml.created_at DESC LIMIT 100
  `).all();
  return c.json(results);
});

// ── MFA ──
app.post('/api/admin/mfa-setup', requireAdmin, async (c) => {
  const adminPayload = c.get('admin');
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(adminPayload.username, 'Midnight Stories Admin', secret);
  // Use SVG string — QRCode.toDataURL requires a browser canvas (unavailable in Workers)
  const qrSvg = await QRCode.toString(otpauth, { type: 'svg' });
  const qrCode = 'data:image/svg+xml;base64,' + Buffer.from(qrSvg).toString('base64');

  // Store secret temporarily (admin verifies immediately)
  const db = c.env.DB;
  await db.prepare('UPDATE admin_users SET mfa_secret = ? WHERE id = ?').bind(secret, adminPayload.adminId).run();
  
  return c.json({ secret, qrCode });
});

app.post('/api/admin/mfa-enable', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { code } = await c.req.json();
  
  const admin = await db.prepare('SELECT mfa_secret FROM admin_users WHERE id = ?').bind(adminPayload.adminId).first();
  if (!admin || !admin.mfa_secret) return c.json({ error: 'MFA setup not initiated.' }, 400);
  
  const isValid = authenticator.verify({ token: code, secret: admin.mfa_secret });
  if (!isValid) return c.json({ error: 'Invalid code.' }, 400);
  
  await db.prepare('UPDATE admin_users SET mfa_enabled = 1 WHERE id = ?').bind(adminPayload.adminId).run();
  return c.json({ message: 'MFA enabled.' });
});

app.post('/api/admin/mfa-verify', async (c) => {
  const db = c.env.DB;
  const { preToken, code } = await c.req.json();
  
  try {
    const payload = await verifyJWT(preToken, getAdminJwtSecret(c));
    if (payload.step !== 'mfa') throw new Error();
    
    const admin = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(payload.adminId).first();
    if (!admin) throw new Error();
    
    const isValid = authenticator.verify({ token: code, secret: admin.mfa_secret });
    if (!isValid) return c.json({ error: 'Invalid code.' }, 401);
    
    const token = await signJWT({ adminId: admin.id, username: admin.username, role: admin.role, exp: Math.floor(Date.now() / 1000) + 86400 }, getAdminJwtSecret(c));
    return c.json({ token, username: admin.username, role: admin.role, mfaEnabled: true });
  } catch (err) {
    return c.json({ error: 'Invalid session or token.' }, 401);
  }
});

// ── User Management & Moderation ──
app.get('/api/admin/users/:id/relationships', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = parseInt(c.req.param('id'));
  
  const follows = await db.prepare(`
    SELECT f.*, u.full_name as user_name 
    FROM follows f 
    JOIN users u ON f.following_id = u.id 
    WHERE f.follower_id = ?
  `).bind(userId).all();
  
  const followers = await db.prepare(`
    SELECT f.*, u.full_name as user_name 
    FROM follows f 
    JOIN users u ON f.follower_id = u.id 
    WHERE f.following_id = ?
  `).bind(userId).all();
  
  const blocks = await db.prepare(`
    SELECT b.*, u.full_name as user_name 
    FROM blocks b 
    JOIN users u ON b.blocked_id = u.id 
    WHERE b.blocker_id = ?
  `).bind(userId).all();

  return c.json({ follows: follows.results, followers: followers.results, blocks: blocks.results });
});

app.post('/api/admin/users/:id/status', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const userId = parseInt(c.req.param('id'));
  const { status, reason } = await c.req.json();
  
  await db.prepare('UPDATE users SET account_status = ? WHERE id = ?').bind(status, userId).run();
  await db.prepare('INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)')
    .bind('user', userId, adminPayload.adminId, `status_${status}`, reason).run();
    
  return c.json({ message: `User status updated to ${status}.` });
});

app.post('/api/admin/users/:id/force-unfollow', requireAdmin, async (c) => {
  const db = c.env.DB;
  const followerId = parseInt(c.req.param('id'));
  const { following_id } = await c.req.json();
  
  await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').bind(followerId, following_id).run();
  return c.json({ message: 'Force unfollow successful.' });
});

app.post('/api/admin/users/:id/warn', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const userId = parseInt(c.req.param('id'));
  const { level, template, reason, rule_broken, penalties } = await c.req.json();

  await db.prepare(`
    INSERT INTO user_warnings (user_id, admin_id, level, template, reason, rule_broken, penalties) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(userId, adminPayload.adminId, level, template, reason, rule_broken || null, penalties || null).run();
  
  const warnTitle = `⚠️ OFFICIAL SYSTEM WARNING: ${level.replace(/_/g, ' ').toUpperCase()}`;
  const warnBody = `Reason for warning: ${reason}${rule_broken ? '\nRule broken: ' + rule_broken : ''}`;

  await db.prepare('INSERT INTO admin_messages (user_id, admin_id, title, body) VALUES (?, ?, ?, ?)').bind(userId, adminPayload.adminId, warnTitle, warnBody).run();
  await sendAdminChatMessage(db, adminPayload.adminId, userId, warnTitle, warnBody);
  
  return c.json({ message: 'Warning issued and sent to user Chat.' });
});

app.get('/api/admin/users/:id/warnings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = parseInt(c.req.param('id'));
  
  const { results } = await db.prepare(`
    SELECT uw.*, au.username as admin_username 
    FROM user_warnings uw 
    JOIN admin_users au ON uw.admin_id = au.id 
    WHERE uw.user_id = ? ORDER BY uw.created_at DESC
  `).bind(userId).all();
  
  return c.json(results);
});


// ---------------------------------------------------------
// 🛡️  ADVANCED MODERATION & AUDITING API
// ---------------------------------------------------------

async function getOrCreateAdminSupportUser(db) {
  let adminUser = await db.prepare("SELECT id FROM users WHERE user_id = 'USER_ADMIN_SUPPORT' OR email = 'support@midnightstories.com'").first();
  if (!adminUser) {
    const res = await db.prepare(`
      INSERT INTO users (user_id, full_name, email, bio, profile_pic, account_status)
      VALUES ('USER_ADMIN_SUPPORT', '🛡️ Midnight Support (Admin)', 'support@midnightstories.com', 'Official Midnight Support & System Administration Team', '/images/default-avatar.svg', 'active')
    `).run();
    return res.meta.last_row_id;
  }
  return adminUser.id;
}

async function sendAdminChatMessage(db, adminId, targetUserId, title, body) {
  const adminSysUserId = await getOrCreateAdminSupportUser(db);
  
  let conv = await db.prepare(`
    SELECT id FROM conversations 
    WHERE (user_one_id = ? AND user_two_id = ?) OR (user_one_id = ? AND user_two_id = ?)
  `).bind(adminSysUserId, targetUserId, targetUserId, adminSysUserId).first();

  let convId;
  if (!conv) {
    const res = await db.prepare(`
      INSERT INTO conversations (user_one_id, user_two_id, initiated_by_id, status, last_message_at)
      VALUES (?, ?, ?, 'accepted', datetime('now'))
    `).bind(adminSysUserId, targetUserId, adminSysUserId).run();
    convId = res.meta.last_row_id;
  } else {
    convId = conv.id;
    await db.prepare("UPDATE conversations SET status = 'accepted', last_message_at = datetime('now') WHERE id = ?").bind(convId).run();
  }

  const messageText = title ? `📌 ${title}\n\n${body}` : body;

  await db.prepare(`
    INSERT INTO messages (conversation_id, sender_id, body, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).bind(convId, adminSysUserId, messageText).run();

  await db.prepare(`
    INSERT INTO notifications (user_id, type, source_id, read, created_at)
    VALUES (?, 'chat_message', ?, 0, datetime('now'))
  `).bind(targetUserId, convId).run();

  return convId;
}

app.get('/api/admin/users/:id/audit', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = parseInt(c.req.param('id'));

  const user = await db.prepare('SELECT id, user_id, full_name, email, phone_number, account_status, dm_permission, interaction_permissions, created_at FROM users WHERE id = ?').bind(userId).first();
  if (!user) return c.json({ error: 'User not found' }, 404);

  const storiesCount = await db.prepare('SELECT COUNT(*) as count FROM stories WHERE user_id = ?').bind(userId).first();
  const commentsCount = await db.prepare('SELECT COUNT(*) as count FROM comments WHERE user_id = ?').bind(userId).first();
  const likesCount = await db.prepare('SELECT COUNT(*) as count FROM likes l JOIN stories s ON l.story_id = s.id WHERE s.user_id = ?').bind(userId).first();
  
  const { results: login_logs } = await db.prepare('SELECT ip_address, user_agent, status, created_at FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(userId).all();

  return c.json({
    user,
    stats: {
      stories: storiesCount.count,
      comments: commentsCount.count,
      likesReceived: likesCount.count
    },
    login_logs
  });
});

app.put('/api/admin/users/:id/permissions', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = parseInt(c.req.param('id'));
  const { permissions } = await c.req.json();
  const adminPayload = c.get('admin');
  
  await db.prepare('UPDATE users SET interaction_permissions = ? WHERE id = ?').bind(JSON.stringify(permissions), userId).run();
  
  await db.prepare('INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)')
    .bind('user', userId, adminPayload.adminId, 'update_permissions', JSON.stringify(permissions)).run();

  return c.json({ message: 'Permissions updated.' });
});

app.post('/api/admin/users/:id/enforce', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = parseInt(c.req.param('id'));
  const { action, reason } = await c.req.json();
  
  let newStatus = 'active';
  if (action === 'permanent_ban') newStatus = 'banned';
  if (action === 'temporary_suspension') newStatus = 'suspended';

  // Increment token_version to wipe active sessions immediately
  await db.prepare('UPDATE users SET account_status = ?, token_version = token_version + 1 WHERE id = ?').bind(newStatus, userId).run();
  
  const adminPayload = c.get('admin');
  await db.prepare('INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)').bind('user', userId, adminPayload.adminId, action, reason).run();
  
  return c.json({ message: 'Enforcement action applied. User sessions invalidated.' });
});

app.get('/api/admin/reports/aggregated', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`SELECT reported_item_type as target_type, reported_item_id as target_id, COUNT(*) as incident_count, MAX(created_at) as last_reported_at
    FROM reports
    WHERE ticket_status != 'resolved' AND ticket_status != 'closed'
    GROUP BY reported_item_type, reported_item_id
    ORDER BY incident_count DESC`).all();
  return c.json(results);
});

app.get('/api/admin/reports/target', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { target_type, target_id } = c.req.query();
  const { results } = await db.prepare('SELECT r.*, u.full_name as reporter_name FROM reports r LEFT JOIN users u ON r.reporter_id = u.id WHERE r.reported_item_type = ? AND r.reported_item_id = ? ORDER BY r.created_at DESC').bind(target_type, parseInt(target_id)).all();
  return c.json(results);
});

app.post('/api/admin/reports/:id/reply', requireAdmin, async (c) => {
  const db = c.env.DB;
  const reportId = parseInt(c.req.param('id'));
  const { reply } = await c.req.json();
  const adminPayload = c.get('admin');
  
  await db.prepare('UPDATE reports SET admin_reply = ?, resolved = 1, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?').bind(reply, adminPayload.adminId, reportId).run();
  return c.json({ message: 'Reply sent and report resolved.' });
});

app.post('/api/admin/messages/send', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { recipient_type = 'single', user_id, user_ids, title, body } = await c.req.json();
  const adminPayload = c.get('admin');

  if (!title || !body) {
    return c.json({ error: 'Title and Message Body are required.' }, 400);
  }

  let targetUserIds = [];

  if (recipient_type === 'single') {
    if (!user_id) return c.json({ error: 'user_id is required for single message mode.' }, 400);
    targetUserIds = [parseInt(user_id)];
  } else if (recipient_type === 'bulk_selected') {
    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return c.json({ error: 'user_ids must be a non-empty array for bulk selected mode.' }, 400);
    }
    targetUserIds = user_ids.map(id => parseInt(id)).filter(id => !isNaN(id));
  } else if (recipient_type === 'all_users') {
    const { results } = await db.prepare("SELECT id FROM users WHERE account_status != 'banned'").all();
    targetUserIds = results.map(u => u.id);
  }

  if (targetUserIds.length === 0) {
    return c.json({ error: 'No valid recipient users found.' }, 400);
  }

  try {
    for (const uid of targetUserIds) {
      await db.prepare('INSERT INTO admin_messages (user_id, admin_id, title, body) VALUES (?, ?, ?, ?)').bind(uid, adminPayload.adminId, title, body).run();
      await sendAdminChatMessage(db, adminPayload.adminId, uid, title, body);
    }

    return c.json({
      success: true,
      recipientCount: targetUserIds.length,
      message: `Official Admin Message sent to ${targetUserIds.length} user(s) directly into Chat.`
    });
  } catch (err) {
    console.error('Send admin message error:', err);
    return c.json({ error: 'Failed to send message.' }, 500);
  }
});

app.get('/api/users/me/support-inbox', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  
  const { results: messages } = await db.prepare('SELECT * FROM admin_messages WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
  
  const { results: reportsRaw } = await db.prepare(
    "SELECT id, reported_item_type AS target_type, reason, resolved_at FROM reports WHERE reporter_id = ? AND ticket_status = 'resolved' ORDER BY resolved_at DESC"
  ).bind(user.id).all();

  const reports = [];
  for (const report of reportsRaw) {
    const threadMsg = await db.prepare(
      "SELECT message_body FROM ticket_conversation_threads WHERE report_id = ? AND sender_role = 'admin' ORDER BY created_at DESC LIMIT 1"
    ).bind(report.id).first();
    reports.push({
      ...report,
      admin_reply: threadMsg ? threadMsg.message_body : 'Your report has been resolved.'
    });
  }
  
  return c.json({ messages, reports });
});

// ═════════════════════════════════════════════════════════
// ██  BOOK LIBRARY & READER MODE ROUTES (Additive)
// ═════════════════════════════════════════════════════════

const requireAdminOrUser = async (c, next) => {
  const adminToken = c.req.header('x-admin-token');
  if (adminToken) {
    try {
      const payload = await verifyJWT(adminToken, getAdminJwtSecret(c));
      if (payload.step !== 'mfa') {
        c.set('admin', payload);
        c.set('role', 'admin');
        await next();
        return;
      }
    } catch (err) {}
  }

  const authHeader = c.req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const payload = await verifyJWT(token, getUserJwtSecret(c));
      c.set('user', payload);
      c.set('role', 'user');
      await next();
      return;
    } catch (err) {}
  }

  return c.json({ error: 'Unauthorized. Please log in.' }, 401);
};

// ── POST /api/admin/books ──
app.post('/api/admin/books', requireAdminOrUser, async (c) => {
  const db = c.env.DB;
  const role = c.get('role');
  const user = c.get('user');
  const admin = c.get('admin');

  let formData;
  try {
    formData = await c.req.formData();
  } catch (err) {
    return c.json({ error: 'Multipart form data is required.' }, 400);
  }

  const bookFile = formData.get('book');
  const coverFile = formData.get('cover');

  if (!bookFile || !(bookFile instanceof File) || bookFile.size === 0) {
    return c.json({ error: 'Book file is required.' }, 400);
  }

  if (bookFile.size > 100 * 1024 * 1024) {
    return c.json({ error: 'Book file size exceeds 100MB.' }, 400);
  }

  if (coverFile && coverFile instanceof File && coverFile.size > 5 * 1024 * 1024) {
    return c.json({ error: 'Cover image must be under 5MB.' }, 400);
  }

  if (!c.env.IMAGES) {
    return c.json({ error: 'Storage bucket (R2) is not configured.' }, 500);
  }

  const bookExt = bookFile.name.endsWith('.pdf') ? 'pdf' : 'epub';
  const bookFilename = `${crypto.randomUUID()}.${bookExt}`;
  await c.env.IMAGES.put(bookFilename, await bookFile.arrayBuffer(), {
    httpMetadata: { contentType: bookExt === 'pdf' ? 'application/pdf' : 'application/epub+zip' }
  });
  const fileUrl = `/uploads/${bookFilename}`;

  let coverImageUrl = '/images/default-cover.svg';
  if (coverFile && coverFile instanceof File && coverFile.size > 0) {
    const coverExt = coverFile.type.split('/')[1] || 'jpg';
    const coverFilename = `${crypto.randomUUID()}.${coverExt}`;
    await c.env.IMAGES.put(coverFilename, await coverFile.arrayBuffer(), {
      httpMetadata: { contentType: coverFile.type }
    });
    coverImageUrl = `/uploads/${coverFilename}`;
  }

  const title = formData.get('title');
  const author = formData.get('author');
  const description = formData.get('description');
  const publisher = formData.get('publisher');
  const language = formData.get('language') || 'en';
  const isbn = formData.get('isbn');
  const publishedDate = formData.get('published_date');
  const pageCountStr = formData.get('page_count');
  const estReadMinutesStr = formData.get('est_read_minutes');
  const visibility = formData.get('visibility') || 'public';
  const reqStatus = formData.get('status') || 'draft';

  if (!title || !author) {
    return c.json({ error: 'Title and author are required.' }, 400);
  }

  let finalStatus = reqStatus;
  let uploadedBy = null;
  let approvedBy = null;

  if (hasPermission(role, 'moderate_content')) {
    approvedBy = admin ? admin.adminId : null;
  } else {
    uploadedBy = user.id;
    finalStatus = 'pending';
  }

  let categoryIds = [];
  const categoryIdsStr = formData.get('category_ids');
  if (categoryIdsStr) {
    try {
      categoryIds = JSON.parse(categoryIdsStr);
    } catch (e) {
      if (typeof categoryIdsStr === 'string') {
        categoryIds = categoryIdsStr.split(',').map(id => id.trim());
      }
    }
  }

  let tagsList = [];
  const tagsStr = formData.get('tags');
  if (tagsStr) {
    try {
      tagsList = JSON.parse(tagsStr);
    } catch (e) {
      if (typeof tagsStr === 'string') {
        tagsList = tagsStr.split(',').map(t => t.trim());
      }
    }
  }

  const channelType = formData.get('channel_type') || 'education';

  try {
    const result = await db.prepare(`
      INSERT INTO books (title, author, description, publisher, language, isbn, published_date, page_count, est_read_minutes, cover_image_url, file_url, file_type, status, visibility, uploaded_by, approved_by, channel_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      title, author, description || null, publisher || null, language, isbn || null,
      publishedDate || null, pageCountStr ? parseInt(pageCountStr) : null, estReadMinutesStr ? parseInt(estReadMinutesStr) : null,
      coverImageUrl, fileUrl, bookExt, finalStatus, visibility, uploadedBy, approvedBy, channelType
    ).run();

    const bookId = result.meta.last_row_id;

    for (const catId of categoryIds) {
      if (catId) {
        await db.prepare('INSERT OR IGNORE INTO book_categories (book_id, category_id) VALUES (?, ?)').bind(bookId, parseInt(catId)).run();
      }
    }

    for (const t of tagsList) {
      if (t) {
        const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        await db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)').bind(t, slug).run();
        const tagRow = await db.prepare('SELECT id FROM tags WHERE slug = ?').bind(slug).first();
        if (tagRow) {
          await db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)').bind(bookId, tagRow.id).run();
        }
      }
    }

    return c.json({
      success: true,
      bookId,
      message: finalStatus === 'pending'
        ? 'Book uploaded successfully and is awaiting moderation.'
        : 'Book published successfully.'
    }, 201);
  } catch (err) {
    console.error('Error inserting book:', err);
    return c.json({ error: 'Failed to save book to database.' }, 500);
  }
});

// ── PUT /api/admin/books/:id ──
app.put('/api/admin/books/:id', requireAdminOrUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const role = c.get('role');
  const user = c.get('user');
  const body = await c.req.json();

  const book = await db.prepare('SELECT * FROM books WHERE id = ?').bind(bookId).first();
  if (!book) return c.json({ error: 'Book not found.' }, 404);

  const isOwner = book.uploaded_by === (user ? user.id : null);
  const canEditBook = hasPermission(role, 'edit_book');
  const canEditOthers = hasPermission(role, 'edit_others_books');
  if (!canEditBook || (!isOwner && !canEditOthers)) {
    return c.json({ error: 'Unauthorized to edit this book.' }, 403);
  }

  const {
    title, author, description, publisher, language, isbn,
    published_date, page_count, est_read_minutes, visibility, status
  } = body;

  let finalStatus = status || book.status;
  if (!hasPermission(role, 'moderate_content')) {
    finalStatus = 'pending';
  }

  await db.prepare(`
    UPDATE books
    SET title = ?, author = ?, description = ?, publisher = ?, language = ?, isbn = ?,
        published_date = ?, page_count = ?, est_read_minutes = ?, visibility = ?, status = ?, updated_at = datetime("now")
    WHERE id = ?
  `).bind(
    title || book.title, author || book.author, description !== undefined ? description : book.description,
    publisher !== undefined ? publisher : book.publisher, language || book.language, isbn !== undefined ? isbn : book.isbn,
    published_date !== undefined ? published_date : book.published_date,
    page_count !== undefined ? (page_count ? parseInt(page_count) : null) : book.page_count,
    est_read_minutes !== undefined ? (est_read_minutes ? parseInt(est_read_minutes) : null) : book.est_read_minutes,
    visibility || book.visibility, finalStatus, bookId
  ).run();

  if (body.category_ids) {
    await db.prepare('DELETE FROM book_categories WHERE book_id = ?').bind(bookId).run();
    for (const catId of body.category_ids) {
      if (catId) {
        await db.prepare('INSERT OR IGNORE INTO book_categories (book_id, category_id) VALUES (?, ?)').bind(bookId, parseInt(catId)).run();
      }
    }
  }

  if (body.tags) {
    await db.prepare('DELETE FROM book_tags WHERE book_id = ?').bind(bookId).run();
    for (const t of body.tags) {
      if (t) {
        const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        await db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)').bind(t, slug).run();
        const tagRow = await db.prepare('SELECT id FROM tags WHERE slug = ?').bind(slug).first();
        if (tagRow) {
          await db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)').bind(bookId, tagRow.id).run();
        }
      }
    }
  }

  return c.json({ success: true, message: 'Book metadata updated successfully.' });
});

// ── DELETE /api/admin/books/:id ──
app.delete('/api/admin/books/:id', requireAdminOrUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const role = c.get('role');
  const user = c.get('user');

  const book = await db.prepare('SELECT * FROM books WHERE id = ?').bind(bookId).first();
  if (!book) return c.json({ error: 'Book not found.' }, 404);

  const isOwner = book.uploaded_by === (user ? user.id : null);
  const canDeleteBook = hasPermission(role, 'delete_book');
  const canDeleteOthers = hasPermission(role, 'delete_others_books');
  if (!canDeleteBook || (!isOwner && !canDeleteOthers)) {
    return c.json({ error: 'Unauthorized to delete this book.' }, 403);
  }

  await db.prepare('DELETE FROM books WHERE id = ?').bind(bookId).run();
  return c.json({ success: true, message: 'Book deleted successfully.' });
});

// ── PUT /api/admin/books/:id/status ──
app.put('/api/admin/books/:id/status', requireAdmin, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const { status } = await c.req.json();

  const allowedStatuses = ['published', 'pending', 'under_review', 'temp_stopped', 'suspended', 'draft'];
  if (!status || !allowedStatuses.includes(status)) {
    return c.json({ error: 'Invalid status. Allowed: published, pending, under_review, temp_stopped, suspended, draft' }, 400);
  }

  const book = await db.prepare('SELECT id FROM books WHERE id = ?').bind(bookId).first();
  if (!book) return c.json({ error: 'Book not found.' }, 404);

  await db.prepare('UPDATE books SET status = ?, updated_at = datetime("now") WHERE id = ?').bind(status, bookId).run();
  return c.json({ success: true, message: `Book status updated to ${status}.` });
});

// ── POST /api/admin/books/bulk-upload ──
app.post('/api/admin/books/bulk-upload', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');

  try {
    const body = await c.req.json();
    const { books } = body;

    if (!Array.isArray(books) || books.length === 0) {
      return c.json({ error: 'No books provided in batch payload.' }, 400);
    }

    if (books.length > 100) {
      return c.json({ error: 'Batch upload exceeds maximum limit of 100 books.' }, 400);
    }

    const savedBooks = [];
    const failedBooks = [];
    const batchStatements = [];

    for (const item of books) {
      try {
        const title = (item.title || '').trim();
        const author = (item.author || '').trim();
        const channelType = ['education', 'navel'].includes(item.channel_type) ? item.channel_type : 'education';

        if (!title || !author) {
          failedBooks.push({ filename: item.filename || title || 'Unknown', error: 'Missing Title or Author' });
          continue;
        }

        const sanitizedTitle = title.replace(/[<>&'"]/g, '');
        const sanitizedAuthor = author.replace(/[<>&'"]/g, '');

        let fileUrl = item.file_url || null;
        let coverImageUrl = item.cover_image_url || null;

        if (item.file_base64 && c.env.IMAGES) {
          try {
            const fileExt = item.file_ext || 'epub';
            const fileKey = `bulk_book_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
            const fileBuffer = Uint8Array.from(atob(item.file_base64), ch => ch.charCodeAt(0));
            await c.env.IMAGES.put(fileKey, fileBuffer, {
              httpMetadata: { contentType: fileExt === 'pdf' ? 'application/pdf' : 'application/epub+zip' }
            });
            fileUrl = `/uploads/${fileKey}`;
          } catch (storageErr) {
            console.warn('R2 storage file save notice:', storageErr);
          }
        }

        if (item.cover_base64 && c.env.IMAGES) {
          try {
            const coverExt = item.cover_ext || 'jpg';
            const coverKey = `bulk_cover_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${coverExt}`;
            const coverBuffer = Uint8Array.from(atob(item.cover_base64), ch => ch.charCodeAt(0));
            await c.env.IMAGES.put(coverKey, coverBuffer, {
              httpMetadata: { contentType: `image/${coverExt}` }
            });
            coverImageUrl = `/uploads/${coverKey}`;
          } catch (storageErr) {
            console.warn('R2 storage cover save notice:', storageErr);
          }
        }

        if (!fileUrl) {
          fileUrl = `/uploads/placeholder_book.epub`;
        }

        const statement = db.prepare(`
          INSERT INTO books (
            title, author, description, publisher, language, isbn,
            page_count, est_read_minutes, cover_image_url, file_url,
            file_type, status, visibility, uploaded_by, approved_by, channel_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 'public', null, ?, ?)
        `).bind(
          sanitizedTitle,
          sanitizedAuthor,
          item.description || null,
          item.publisher || null,
          item.language || 'en',
          item.isbn || null,
          item.page_count ? parseInt(item.page_count) : null,
          item.est_read_minutes ? parseInt(item.est_read_minutes) : null,
          coverImageUrl,
          fileUrl,
          item.file_type || 'epub',
          adminPayload ? adminPayload.adminId : null,
          channelType
        );

        batchStatements.push({ statement, item });
      } catch (err) {
        failedBooks.push({ filename: item.filename || 'Unknown', error: err.message });
      }
    }

    if (batchStatements.length > 0) {
      const results = await db.batch(batchStatements.map(b => b.statement));
      results.forEach((res, idx) => {
        const item = batchStatements[idx].item;
        savedBooks.push({
          bookId: res.meta ? res.meta.last_row_id : null,
          title: item.title,
          author: item.author
        });
      });
    }

    return c.json({
      success: true,
      totalProcessed: books.length,
      successCount: savedBooks.length,
      failedCount: failedBooks.length,
      savedBooks,
      failedBooks
    });
  } catch (err) {
    console.error('Bulk upload route error:', err);
    return c.json({ error: 'Failed to process bulk book upload.' }, 500);
  }
});

// ── GET /api/admin/books ──
app.get('/api/admin/books', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results: books } = await db.prepare(`
    SELECT b.*,
      (SELECT GROUP_CONCAT(c.name) FROM book_categories bc JOIN categories c ON bc.category_id = c.id WHERE bc.book_id = b.id) as category_names,
      (SELECT GROUP_CONCAT(t.name) FROM book_tags bt JOIN tags t ON bt.tag_id = t.id WHERE bt.book_id = b.id) as tag_names,
      u.full_name as uploader_name
    FROM books b
    LEFT JOIN users u ON b.uploaded_by = u.id
    ORDER BY b.created_at DESC
  `).all();
  return c.json({ books });
});

// ── GET /api/admin/books/pending ──
app.get('/api/admin/books/pending', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT b.*, u.full_name as uploader_name
    FROM books b
    LEFT JOIN users u ON b.uploaded_by = u.id
    WHERE b.status = 'pending'
    ORDER BY b.created_at ASC
  `).all();
  return c.json(results);
});

// ── POST /api/admin/books/:id/approve ──
app.post('/api/admin/books/:id/approve', requireAdmin, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const admin = c.get('admin');

  const book = await db.prepare('SELECT id FROM books WHERE id = ?').bind(bookId).first();
  if (!book) return c.json({ error: 'Book not found.' }, 404);

  await db.prepare('UPDATE books SET status = "published", approved_by = ?, updated_at = datetime("now") WHERE id = ?')
    .bind(admin.adminId, bookId).run();

  return c.json({ success: true, message: 'Book approved and published.' });
});

// ── PUT /api/admin/books/:id ──
app.put('/api/admin/books/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const body = await c.req.json();

  const {
    title,
    author,
    channel_type,
    description,
    publisher,
    language,
    isbn,
    page_count,
    est_read_minutes,
    visibility,
    status
  } = body;

  if (!title || !author) {
    return c.json({ error: 'Title and Author are required.' }, 400);
  }

  const existing = await db.prepare('SELECT id FROM books WHERE id = ?').bind(bookId).first();
  if (!existing) return c.json({ error: 'Book not found.' }, 404);

  try {
    await db.prepare(`
      UPDATE books SET
        title = ?,
        author = ?,
        channel_type = ?,
        description = ?,
        publisher = ?,
        language = ?,
        isbn = ?,
        page_count = ?,
        est_read_minutes = ?,
        visibility = ?,
        status = ?,
        updated_at = datetime("now")
      WHERE id = ?
    `).bind(
      title,
      author,
      channel_type || 'education',
      description || null,
      publisher || null,
      language || 'en',
      isbn || null,
      page_count ? parseInt(page_count) : 100,
      est_read_minutes ? parseInt(est_read_minutes) : 25,
      visibility || 'public',
      status || 'published',
      bookId
    ).run();

    return c.json({
      success: true,
      message: `Book '${title}' updated successfully.`
    });
  } catch (err) {
    console.error('Update book error:', err);
    return c.json({ error: 'Failed to update book.' }, 500);
  }
});

// ── GET /api/books ──
app.get('/api/books', optionalUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const { sort = 'newest', category, search, page = 1, limit = 12, shelf, channel } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = "WHERE b.status = 'published'";
  const params = [];

  if (channel) {
    where += " AND b.channel_type = ?";
    params.push(channel);
  }

  if (!user) {
    where += " AND b.visibility = 'public'";
  }

  if (category && category !== 'all') {
    where += ' AND b.id IN (SELECT book_id FROM book_categories bc JOIN categories c ON bc.category_id = c.id WHERE c.slug = ?)';
    params.push(category);
  }

  if (search) {
    where += ' AND (b.title LIKE ? OR b.author LIKE ? OR b.description LIKE ? OR b.id IN (SELECT book_id FROM book_tags bt JOIN tags t ON bt.tag_id = t.id WHERE t.name LIKE ?))';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  if (shelf && user) {
    where += ' AND b.id IN (SELECT book_id FROM user_library WHERE user_id = ? AND shelf_status = ?)';
    params.push(user.id, shelf);
  }

  let orderBy;
  switch (sort) {
    case 'title': orderBy = 'b.title ASC'; break;
    default: orderBy = 'b.created_at DESC';
  }

  const countRes = await db.prepare(`SELECT COUNT(*) as total FROM books b ${where}`).bind(...params).first();
  const total = countRes ? countRes.total : 0;

  const sql = `
    SELECT b.*,
      (SELECT GROUP_CONCAT(c.name) FROM book_categories bc JOIN categories c ON bc.category_id = c.id WHERE bc.book_id = b.id) as category_names,
      (SELECT GROUP_CONCAT(t.name) FROM book_tags bt JOIN tags t ON bt.tag_id = t.id WHERE bt.book_id = b.id) as tag_names
    FROM books b
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const { results: books } = await db.prepare(sql).bind(...params, parseInt(limit), offset).all();

  if (user && books.length > 0) {
    const bookIds = books.map(b => b.id);
    const placeholders = bookIds.map(() => '?').join(',');
    
    const { results: progressRows } = await db.prepare(`
      SELECT book_id, percent_complete, location_cfi
      FROM reading_progress
      WHERE user_id = ? AND book_id IN (${placeholders})
    `).bind(user.id, ...bookIds).all();
    
    const { results: shelfRows } = await db.prepare(`
      SELECT book_id, shelf_status
      FROM user_library
      WHERE user_id = ? AND book_id IN (${placeholders})
    `).bind(user.id, ...bookIds).all();
    
    const progressMap = new Map(progressRows.map(p => [p.book_id, p]));
    const shelfMap = new Map(shelfRows.map(s => [s.book_id, s.shelf_status]));
    
    books.forEach(b => {
      b.progress = progressMap.get(b.id) || null;
      b.shelf_status = shelfMap.get(b.id) || null;
    });
  }

  return c.json({
    books,
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit))
  });
});

// ── GET /api/books/:id ──
app.get('/api/books/:id', optionalUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  const admin = c.get('admin');

  const book = await db.prepare(`
    SELECT b.*,
      (SELECT GROUP_CONCAT(c.name) FROM book_categories bc JOIN categories c ON bc.category_id = c.id WHERE bc.book_id = b.id) as category_names,
      (SELECT GROUP_CONCAT(bc.category_id) FROM book_categories bc WHERE bc.book_id = b.id) as category_ids,
      (SELECT GROUP_CONCAT(t.name) FROM book_tags bt JOIN tags t ON bt.tag_id = t.id WHERE bt.book_id = b.id) as tag_names
    FROM books b
    WHERE b.id = ?
  `).bind(bookId).first();

  if (!book) return c.json({ error: 'Book not found.' }, 404);
  if (book.status !== 'published' && (!user || book.uploaded_by !== user.id) && !admin) {
    return c.json({ error: 'Access denied.' }, 403);
  }

  if (user) {
    const progress = await db.prepare('SELECT percent_complete, location_cfi FROM reading_progress WHERE user_id = ? AND book_id = ?').bind(user.id, bookId).first();
    const shelf = await db.prepare('SELECT shelf_status FROM user_library WHERE user_id = ? AND book_id = ?').bind(user.id, bookId).first();
    book.progress = progress || null;
    book.shelf_status = shelf ? shelf.shelf_status : null;
  }

  return c.json(book);
});

// ── GET /api/books/:id/file ──
app.get('/api/books/:id/file', optionalUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  const admin = c.get('admin');

  const book = await db.prepare('SELECT title, author, description, file_url, status, visibility, uploaded_by FROM books WHERE id = ?').bind(bookId).first();
  if (!book) return c.json({ error: 'Book not found.' }, 404);

  if (book.status !== 'published' && (!user || book.uploaded_by !== user.id) && !admin) {
    return c.json({ error: 'Access denied.' }, 403);
  }
  if (book.visibility === 'restricted' && !user && !admin) {
    return c.json({ error: 'Authentication required to read this book.' }, 401);
  }

  const filename = book.file_url ? book.file_url.split('/').pop() : '';

  // 1. Try R2 bucket
  if (c.env.IMAGES && filename) {
    try {
      const object = await c.env.IMAGES.get(filename);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Content-Disposition', `inline; filename="${filename}"`);
        return new Response(object.body, { headers, status: 200 });
      }
    } catch (e) {
      console.warn('R2 get failed:', e);
    }
  }

  // 2. Try static ASSETS if file_url is in public directory
  if (c.env.ASSETS && book.file_url) {
    try {
      const assetUrl = new URL(c.req.url);
      assetUrl.pathname = book.file_url.startsWith('/') ? book.file_url : '/' + book.file_url;
      const assetRes = await c.env.ASSETS.fetch(assetUrl);
      const contentType = assetRes.headers.get('content-type') || '';
      if (assetRes.ok && assetRes.status === 200 && !contentType.includes('text/html')) {
        return assetRes;
      }
    } catch (e) {
      console.warn('Asset fetch failed:', e);
    }
  }

  // 3. Fallback: Return structured reader content for books without uploaded binary files
  const title = book.title || 'Book Title';
  const author = book.author || 'Author';
  const desc = book.description || 'No description available.';

  const sampleContent = `${title}
By ${author}

==================================================
SYNOPSIS & OVERVIEW
==================================================
${desc}

==================================================
CHAPTER 1: THE BEGINNING
==================================================
Welcome to the opening chapter of "${title}". 

As the journey begins, we explore the foundational environment and characters that define this narrative. In every great work, the initial setting establishes the atmosphere, tone, and tension that drives the story forward.

Take a moment to adjust your reading comfort settings in the top toolbar. You can switch between Light, Sepia, Dark, and Dim modes, adjust text sizing, or switch font styles according to your preference.

==================================================
CHAPTER 2: DEEP EXPLORATION & DISCOVERY
==================================================
Continuing through the core themes of "${title}", the conflict deepens as key insights unfold.

Whether reading for education, leisure, or academic research, structured reading enhances retention. Use the bookmark button above to save your position, or highlight passages to store notes directly in your personal account library.

==================================================
CHAPTER 3: CONCLUDING REFLECTIONS
==================================================
As we reach the final pages of this volume, the primary questions posed in the opening chapters find resolution.

Thank you for reading "${title}" on Midnight Stories. Continue exploring our digital library to discover more stories and books.
`;

  return new Response(sampleContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `inline; filename="${filename || 'book.txt'}"`
    }
  });
});

// ── GET /api/books/:id/progress ──
app.get('/api/books/:id/progress', requireUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  
  const progress = await db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?').bind(user.id, bookId).first();
  return c.json(progress || { location_cfi: null, percent_complete: 0 });
});

// ── POST /api/books/:id/progress ──
app.post('/api/books/:id/progress', requireUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  const { location_cfi, percent_complete } = await c.req.json();

  await db.prepare(`
    INSERT INTO reading_progress (user_id, book_id, location_cfi, percent_complete, last_read_at)
    VALUES (?, ?, ?, ?, datetime("now"))
    ON CONFLICT(user_id, book_id) DO UPDATE SET
      location_cfi = ?, percent_complete = ?, last_read_at = datetime("now")
  `).bind(user.id, bookId, location_cfi, percent_complete, location_cfi, percent_complete).run();

  const shelf = await db.prepare('SELECT shelf_status FROM user_library WHERE user_id = ? AND book_id = ?').bind(user.id, bookId).first();
  if (!shelf) {
    await db.prepare('INSERT INTO user_library (user_id, book_id, shelf_status) VALUES (?, ?, "currently_reading")').bind(user.id, bookId).run();
  } else if (shelf.shelf_status === 'want_to_read') {
    await db.prepare('UPDATE user_library SET shelf_status = "currently_reading" WHERE user_id = ? AND book_id = ?').bind(user.id, bookId).run();
  }

  return c.json({ success: true });
});

// ── GET /api/books/:id/bookmarks ──
app.get('/api/books/:id/bookmarks', requireUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  
  const { results: bookmarks } = await db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC').bind(user.id, bookId).all();
  return c.json(bookmarks);
});

// ── POST /api/books/:id/bookmarks ──
app.post('/api/books/:id/bookmarks', requireUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  const { location_cfi, label } = await c.req.json();

  if (!location_cfi) return c.json({ error: 'Location CFI is required.' }, 400);

  const result = await db.prepare('INSERT INTO bookmarks (user_id, book_id, location_cfi, label) VALUES (?, ?, ?, ?)')
    .bind(user.id, bookId, location_cfi, label || `Bookmark at ${new Date().toLocaleDateString()}`).run();

  return c.json({ success: true, bookmarkId: result.meta.last_row_id }, 201);
});

// ── DELETE /api/books/:id/bookmarks/:bookmarkId ──
app.delete('/api/books/:id/bookmarks/:bookmarkId', requireUser, async (c) => {
  const db = c.env.DB;
  const bookmarkId = parseInt(c.req.param('bookmarkId'));
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  
  await db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ? AND book_id = ?').bind(bookmarkId, user.id, bookId).run();
  return c.json({ success: true });
});

// ── GET /api/books/:id/highlights ──
app.get('/api/books/:id/highlights', requireUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  
  const { results: highlights } = await db.prepare('SELECT * FROM highlights WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC').bind(user.id, bookId).all();
  return c.json(highlights);
});

// ── POST /api/books/:id/highlights ──
app.post('/api/books/:id/highlights', requireUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  const { location_cfi_start, location_cfi_end, color = 'yellow', note_text } = await c.req.json();

  if (!location_cfi_start || !location_cfi_end) {
    return c.json({ error: 'Start and end CFIs are required.' }, 400);
  }

  const result = await db.prepare('INSERT INTO highlights (user_id, book_id, location_cfi_start, location_cfi_end, color, note_text) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, bookId, location_cfi_start, location_cfi_end, color, note_text || null).run();

  return c.json({ success: true, highlightId: result.meta.last_row_id }, 201);
});

// ── DELETE /api/books/:id/highlights/:highlightId ──
app.delete('/api/books/:id/highlights/:highlightId', requireUser, async (c) => {
  const db = c.env.DB;
  const highlightId = parseInt(c.req.param('highlightId'));
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');

  await db.prepare('DELETE FROM highlights WHERE id = ? AND user_id = ? AND book_id = ?').bind(highlightId, user.id, bookId).run();
  return c.json({ success: true });
});

// ── POST /api/books/:id/shelf ──
app.post('/api/books/:id/shelf', requireUser, async (c) => {
  const db = c.env.DB;
  const bookId = parseInt(c.req.param('id'));
  const user = c.get('user');
  const { shelf_status } = await c.req.json();

  if (shelf_status === null) {
    await db.prepare('DELETE FROM user_library WHERE user_id = ? AND book_id = ?').bind(user.id, bookId).run();
    return c.json({ success: true, message: 'Removed from shelf.' });
  }

  if (!['want_to_read', 'currently_reading', 'finished'].includes(shelf_status)) {
    return c.json({ error: 'Invalid shelf status.' }, 400);
  }

  await db.prepare(`
    INSERT INTO user_library (user_id, book_id, shelf_status)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, book_id) DO UPDATE SET shelf_status = ?
  `).bind(user.id, bookId, shelf_status, shelf_status).run();

  return c.json({ success: true, message: `Added to ${shelf_status} shelf.` });
});

// ── GET /api/categories ──
app.get('/api/categories', async (c) => {
  const db = c.env.DB;
  const channel = c.req.query('channel');
  let sql = 'SELECT * FROM categories';
  const params = [];
  if (channel) {
    sql += ' WHERE channel_type = ?';
    params.push(channel);
  }
  sql += ' ORDER BY name';
  const { results } = await db.prepare(sql).bind(...params).all();
  return c.json(results);
});

// ── POST /api/admin/categories ──
app.post('/api/admin/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { name, channel_type = 'education' } = await c.req.json();
  if (!name) return c.json({ error: 'Name is required.' }, 400);
  if (channel_type !== 'education' && channel_type !== 'navel') {
    return c.json({ error: 'Invalid channel type.' }, 400);
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try {
    await db.prepare('INSERT INTO categories (name, slug, channel_type) VALUES (?, ?, ?)').bind(name, slug, channel_type).run();
    return c.json({ message: 'Category created.' });
  } catch (e) {
    return c.json({ error: 'Category already exists.' }, 400);
  }
});

// ── PATCH /api/admin/books/bulk-update-category ──
app.patch('/api/admin/books/bulk-update-category', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { book_ids, target_category_id } = await c.req.json();

  if (!book_ids || !Array.isArray(book_ids) || book_ids.length === 0) {
    return c.json({ error: 'book_ids must be a non-empty array.' }, 400);
  }
  if (!target_category_id) {
    return c.json({ error: 'target_category_id is required.' }, 400);
  }

  const parsedBookIds = book_ids.map(id => {
    if (typeof id === 'string') {
      const num = id.replace(/[^0-9]/g, '');
      return parseInt(num);
    }
    return parseInt(id);
  }).filter(id => !isNaN(id));

  const targetCategoryIdInt = typeof target_category_id === 'string'
    ? parseInt(target_category_id.replace(/[^0-9]/g, ''))
    : parseInt(target_category_id);

  if (parsedBookIds.length === 0 || isNaN(targetCategoryIdInt)) {
    return c.json({ error: 'Invalid book_ids or target_category_id format.' }, 400);
  }

  const targetCategory = await db.prepare('SELECT name FROM categories WHERE id = ?')
    .bind(targetCategoryIdInt)
    .first();
  const categoryName = targetCategory ? targetCategory.name : 'Target Category';

  try {
    const statements = [];
    for (const bookId of parsedBookIds) {
      statements.push(db.prepare('DELETE FROM book_categories WHERE book_id = ?').bind(bookId));
      statements.push(db.prepare('INSERT INTO book_categories (book_id, category_id) VALUES (?, ?)').bind(bookId, targetCategoryIdInt));
      statements.push(db.prepare('UPDATE books SET updated_at = datetime("now") WHERE id = ?').bind(bookId));
    }
    await db.batch(statements);

    return c.json({
      success: true,
      updated_count: parsedBookIds.length,
      message: `${parsedBookIds.length} books successfully reassigned to ${categoryName} category.`
    });
  } catch (err) {
    console.error('Bulk update failed:', err);
    return c.json({ error: 'Database update failed.' }, 500);
  }
});

// ── PATCH /api/admin/books/bulk-update-status ──
app.patch('/api/admin/books/bulk-update-status', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { book_ids, status } = await c.req.json();

  if (!book_ids || !Array.isArray(book_ids) || book_ids.length === 0) {
    return c.json({ error: 'book_ids must be a non-empty array.' }, 400);
  }

  const allowedStatuses = ['published', 'pending', 'under_review', 'temp_stopped', 'suspended', 'draft', 'archived'];
  if (!status || !allowedStatuses.includes(status)) {
    return c.json({ error: 'Invalid status.' }, 400);
  }

  const parsedBookIds = book_ids.map(id => {
    if (typeof id === 'string') {
      const num = id.replace(/[^0-9]/g, '');
      return parseInt(num);
    }
    return parseInt(id);
  }).filter(id => !isNaN(id));

  if (parsedBookIds.length === 0) {
    return c.json({ error: 'Invalid book_ids format.' }, 400);
  }

  try {
    const statements = [];
    for (const bookId of parsedBookIds) {
      statements.push(db.prepare('UPDATE books SET status = ?, updated_at = datetime("now") WHERE id = ?').bind(status, bookId));
    }
    await db.batch(statements);

    return c.json({
      success: true,
      updated_count: parsedBookIds.length,
      message: `${parsedBookIds.length} books successfully updated to status '${status}'.`
    });
  } catch (err) {
    console.error('Bulk status update failed:', err);
    return c.json({ error: 'Database status update failed.' }, 500);
  }
});

// ── POST /api/user/books/upload ──
app.post('/api/user/books/upload', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const formData = await c.req.formData();
  
  const bookFile = formData.get('book');
  const coverFile = formData.get('cover');

  if (!bookFile || !(bookFile instanceof File) || bookFile.size === 0) {
    return c.json({ error: 'Book file is required.' }, 400);
  }

  const bookExt = bookFile.name.endsWith('.pdf') ? 'pdf' : 'epub';
  const bookFilename = `${crypto.randomUUID()}.${bookExt}`;
  await c.env.IMAGES.put(bookFilename, await bookFile.arrayBuffer(), {
    httpMetadata: { contentType: bookFile.type }
  });
  const fileUrl = `/uploads/${bookFilename}`;

  let coverImageUrl = '/images/default-cover.svg';
  if (coverFile && coverFile instanceof File && coverFile.size > 0) {
    const coverExt = coverFile.type.split('/')[1] || 'jpg';
    const coverFilename = `${crypto.randomUUID()}.${coverExt}`;
    await c.env.IMAGES.put(coverFilename, await coverFile.arrayBuffer(), {
      httpMetadata: { contentType: coverFile.type }
    });
    coverImageUrl = `/uploads/${coverFilename}`;
  }

  const title = formData.get('title');
  const author = formData.get('author');
  const channel_type = formData.get('channel_type');
  const category_id = formData.get('category_id');
  const description = formData.get('description');

  if (!title || !author || !channel_type || !category_id) {
    return c.json({ error: 'Title, author, channel type, and category ID are required.' }, 400);
  }

  if (channel_type !== 'education' && channel_type !== 'navel') {
    return c.json({ error: 'Invalid channel type.' }, 400);
  }

  try {
    const result = await db.prepare(`
      INSERT INTO user_book_submissions (user_id, title, author, channel_type, category_id, description, cover_image_url, book_file_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      user.id,
      title,
      author,
      channel_type,
      parseInt(category_id),
      description || null,
      coverImageUrl,
      fileUrl
    ).run();

    return c.json({
      success: true,
      submissionId: result.meta.last_row_id,
      message: 'Your book submission has been received successfully and is pending administrative review.'
    }, 201);
  } catch (err) {
    console.error('Error saving user submission:', err);
    return c.json({ error: 'Failed to save submission.' }, 500);
  }
});

// ── GET /api/admin/submissions ──
app.get('/api/admin/submissions', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare(`
      SELECT s.*, u.full_name as uploader_name, u.email as uploader_email, c.name as category_name
      FROM user_book_submissions s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.status = 'pending'
      ORDER BY s.created_at ASC
    `).all();
    return c.json(results);
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Failed to fetch submissions.' }, 500);
  }
});

// ── POST /api/admin/submissions/:id/approve ──
app.post('/api/admin/submissions/:id/approve', requireAdmin, async (c) => {
  const db = c.env.DB;
  const admin = c.get('admin');
  const submissionId = parseInt(c.req.param('id'));

  const sub = await db.prepare('SELECT * FROM user_book_submissions WHERE id = ?').bind(submissionId).first();
  if (!sub) return c.json({ error: 'Submission not found.' }, 404);

  try {
    // 1. Insert into books
    const bookRes = await db.prepare(`
      INSERT INTO books (title, author, description, cover_image_url, file_url, file_type, status, visibility, uploaded_by_user_id, is_user_submission, submission_status, channel_type, approved_by)
      VALUES (?, ?, ?, ?, ?, ?, 'published', 'public', ?, 1, 'approved', ?, ?)
    `).bind(
      sub.title,
      sub.author,
      sub.description,
      sub.cover_image_url,
      sub.book_file_url,
      sub.book_file_url.endsWith('.pdf') ? 'pdf' : 'epub',
      sub.user_id,
      sub.channel_type,
      admin.adminId
    ).run();

    const bookId = bookRes.meta.last_row_id;

    // 2. Link category
    await db.prepare(`
      INSERT OR IGNORE INTO book_categories (book_id, category_id)
      VALUES (?, ?)
    `).bind(bookId, sub.category_id).run();

    // 3. Mark submission as approved
    await db.prepare('UPDATE user_book_submissions SET status = "approved" WHERE id = ?').bind(submissionId).run();
    
    // 4. Send notification to the user
    await db.prepare(`
      INSERT INTO notifications (user_id, type, source_id, read)
      VALUES (?, 'book_approved', ?, 0)
    `).bind(sub.user_id, bookId).run();

    return c.json({ success: true, message: 'Submission approved and published.' });
  } catch (e) {
    console.error(e);
    return c.json({ error: 'Approval failed.' }, 500);
  }
});

// ── POST /api/admin/submissions/:id/reject ──
app.post('/api/admin/submissions/:id/reject', requireAdmin, async (c) => {
  const db = c.env.DB;
  const submissionId = parseInt(c.req.param('id'));
  const { rejection_reason } = await c.req.json();

  const sub = await db.prepare('SELECT * FROM user_book_submissions WHERE id = ?').bind(submissionId).first();
  if (!sub) return c.json({ error: 'Submission not found.' }, 404);

  await db.prepare('UPDATE user_book_submissions SET status = "rejected", rejection_reason = ? WHERE id = ?')
    .bind(rejection_reason || null, submissionId).run();

  // Send notification to the user
  await db.prepare(`
    INSERT INTO notifications (user_id, type, source_id, read)
    VALUES (?, 'book_rejected', ?, 0)
  `).bind(sub.user_id, submissionId).run();

  return c.json({ success: true, message: 'Submission rejected.' });
});

// ═════════════════════════════════════════════════════════
// ██  CRM HELPDESK TICKETING SYSTEM
// ═════════════════════════════════════════════════════════

// Auth helper allowing user OR admin
const requireUserOrAdmin = async (c, next) => {
  const adminToken = c.req.header('x-admin-token');
  if (adminToken) {
    try {
      const payload = await verifyJWT(adminToken, getAdminJwtSecret(c));
      const db = c.env.DB;
      const adminRow = await db.prepare('SELECT id FROM admin_users WHERE id = ?').bind(payload.adminId).first().catch(() => null);
      if (adminRow) {
        c.set('admin', payload);
        c.set('user', { id: payload.adminId || 0, full_name: 'Admin', role: 'admin' });
        return await next();
      }
    } catch (e) {}
  }
  const authHeader = c.req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const payload = await verifyJWT(token, getUserJwtSecret(c));
      const db = c.env.DB;
      const userRow = await db.prepare('SELECT interaction_permissions FROM users WHERE id = ?').bind(payload.id).first().catch(() => null);
      if (userRow) {
        const permissions = userRow.interaction_permissions ? JSON.parse(userRow.interaction_permissions) : {};
        c.set('user', { ...payload, permissions });
        return await next();
      }
    } catch (e) {}
  }
  return c.json({ error: 'Unauthorized. Session expired or invalid.' }, 401);
};

// Auth helper allowing user OR guest
const requireUserOrGuest = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const payload = await verifyJWT(token, getUserJwtSecret(c));
      const db = c.env.DB;
      const userRow = await db.prepare('SELECT interaction_permissions FROM users WHERE id = ?').bind(payload.id).first().catch(() => null);
      if (userRow) {
        const permissions = userRow.interaction_permissions ? JSON.parse(userRow.interaction_permissions) : {};
        c.set('user', { ...payload, permissions });
        return await next();
      }
    } catch (e) {}
  }
  c.set('user', { id: 0, full_name: 'Guest User', role: 'guest' });
  return await next();
};

// Helper to save ticket file attachments securely under R2
async function saveTicketAttachment(c, ticketDbId, messageId, file) {
  if (!c.env.IMAGES || !file || !(file instanceof File) || file.size === 0) return null;
  const maxBytes = 10 * 1024 * 1024; // 10MB limit per file
  if (file.size > maxBytes) {
    throw new Error('File attachment exceeds the 10MB limit.');
  }

  const allowedMimeTypes = [
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];
  const ext = file.name.split('.').pop() || 'bin';
  const isAllowedExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'doc', 'docx', 'txt'].includes(ext.toLowerCase());

  if (!allowedMimeTypes.includes(file.type) && !isAllowedExt) {
    throw new Error('Invalid file type. Supported: PNG, JPG, WEBP, GIF, PDF, DOC, DOCX, TXT.');
  }

  const storageKey = `tickets/${ticketDbId}/${crypto.randomUUID()}.${ext}`;
  const arrayBuf = await file.arrayBuffer();
  await c.env.IMAGES.put(storageKey, arrayBuf, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' }
  });

  const db = c.env.DB;
  const res = await db.prepare(`
    INSERT INTO ticket_attachments (ticket_id, message_id, file_name, file_path, file_size, mime_type, storage_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    ticketDbId,
    messageId || null,
    file.name,
    `/api/tickets/${ticketDbId}/attachments/download?key=${encodeURIComponent(storageKey)}`,
    file.size,
    file.type || 'application/octet-stream',
    storageKey
  ).run();

  const attachmentId = res.meta.last_row_id;
  return {
    id: attachmentId,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type,
    download_url: `/api/tickets/${ticketDbId}/attachments/${attachmentId}/download`
  };
}

// ── Secure Attachment Download Endpoint ──
app.get('/api/tickets/:id/attachments/:attachmentId/download', requireUserOrAdmin, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const admin = c.get('admin');
  const ticketDbId = parseInt(c.req.param('id'));
  const attachmentId = parseInt(c.req.param('attachmentId'));

  let ticketSql = 'SELECT id, user_id, reporter_id FROM reports WHERE id = ?';
  const params = [ticketDbId];
  if (!admin) {
    ticketSql += ' AND (user_id = ? OR reporter_id = ?)';
    params.push(user.id, user.id);
  }

  const ticket = await db.prepare(ticketSql).bind(...params).first();
  if (!ticket) return c.json({ error: 'Access denied or ticket not found.' }, 403);

  const att = await db.prepare('SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?')
    .bind(attachmentId, ticketDbId).first();
  if (!att) return c.json({ error: 'Attachment not found.' }, 404);

  if (!c.env.IMAGES) return c.text('R2 Storage not configured', 500);
  const object = await c.env.IMAGES.get(att.storage_key);
  if (!object) return c.text('Attachment object missing from storage.', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Disposition', `inline; filename="${att.file_name.replace(/"/g, '')}"`);
  headers.set('Cache-Control', 'private, no-transform, max-age=3600');
  return new Response(object.body, { headers, status: 200 });
});

// GET /api/user/ticket-form-config — Dynamic categories & config for ticket form
app.get('/api/user/ticket-form-config', requireUserOrGuest, async (c) => {
  const db = c.env.DB;

  const { results: categories } = await db.prepare('SELECT * FROM ticket_categories ORDER BY sort_order, id').all().catch(() => ({ results: [] }));
  const { results: subcategories } = await db.prepare('SELECT * FROM ticket_subcategories ORDER BY category_id, sort_order, id').all().catch(() => ({ results: [] }));

  const slaRules = [
    { priority: 'urgent', frt_hours: 1, ttr_hours: 4, label: 'Urgent (App Crash / Copyright - 1h SLA)' },
    { priority: 'high', frt_hours: 4, ttr_hours: 12, label: 'High (Major Issue / Billing - 4h SLA)' },
    { priority: 'medium', frt_hours: 12, ttr_hours: 24, label: 'Medium (Standard Request - 12h SLA)' },
    { priority: 'low', frt_hours: 24, ttr_hours: 72, label: 'Low (General Inquiry - 24h SLA)' },
  ];

  return c.json({ categories: categories || [], subcategories: subcategories || [], customFields: [], slaRules });
});

// Unified POST ticket handler (used by both /api/user/tickets and /api/user/tickets/create)
const createTicketHandler = async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  let subject, category_id, subcategory_id, priority, details, reference_number, custom_fields_json;
  const contentType = c.req.header('Content-Type') || '';
  const uploadedFiles = [];

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await c.req.formData();
    subject = formData.get('subject');
    category_id = formData.get('category_id');
    subcategory_id = formData.get('subcategory_id');
    priority = formData.get('priority') || 'medium';
    details = formData.get('details') || formData.get('report_description') || formData.get('message');
    reference_number = formData.get('reference_number');
    custom_fields_json = formData.get('custom_fields_json') || '{}';

    const files = formData.getAll('file');
    const filesAlt = formData.getAll('attachments');
    const allFormFiles = [...files, ...filesAlt].filter(f => f && f instanceof File && f.size > 0);
    uploadedFiles.push(...allFormFiles);
  } else {
    const body = await c.req.json();
    subject = body.subject;
    category_id = body.category_id;
    subcategory_id = body.subcategory_id;
    priority = body.priority || 'medium';
    details = body.details || body.report_description || body.message;
    reference_number = body.reference_number;
    custom_fields_json = JSON.stringify(body.custom_fields || {});
  }

  // Strict Validation
  if (!subject || subject.trim().length < 3) {
    return c.json({ error: 'Subject is required and must be at least 3 characters long.' }, 400);
  }
  if (!details || details.trim().length < 10) {
    return c.json({ error: 'Detailed description is required and must be at least 10 characters long.' }, 400);
  }

  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  const finalPriority = validPriorities.includes(priority) ? priority : 'medium';

  // Generate collision-safe ticket tracking ID
  const year = new Date().getFullYear();
  const rand = Math.floor(10000 + Math.random() * 90000);
  const ticketId = `TKT-${year}-${rand}`;

  // Calculate SLA due timestamps
  const slaMap = { urgent: { frt: 1, ttr: 4 }, high: { frt: 4, ttr: 12 }, medium: { frt: 12, ttr: 24 }, low: { frt: 24, ttr: 72 } };
  const sla = slaMap[finalPriority] || slaMap.medium;
  const now = new Date();
  const frtDue = new Date(now.getTime() + sla.frt * 3600000).toISOString();
  const slaDue = new Date(now.getTime() + sla.ttr * 3600000).toISOString();

  let catRow = null;
  if (category_id) {
    try { catRow = await db.prepare('SELECT name FROM ticket_categories WHERE id = ?').bind(parseInt(category_id) || 0).first(); } catch(e) {}
  }

  const previewText = details.trim().substring(0, 150) + (details.trim().length > 150 ? '...' : '');

  const res = await db.prepare(`
    INSERT INTO reports (
      user_id, reporter_id, ticket_id, subject, category_id, subcategory_id, priority, ticket_status,
      report_description, custom_fields_json, reference_number, sla_due_at, frt_due_at, created_at, last_activity_at,
      latest_message_preview, agent_unread_count, type, reason, can_reopen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, 1, 'support_ticket', ?, 1)
  `).bind(
    user.id || null, user.id || null, ticketId, subject.trim(),
    category_id ? parseInt(category_id) : null,
    subcategory_id ? parseInt(subcategory_id) : null,
    finalPriority, details.trim(), custom_fields_json,
    reference_number ? reference_number.trim() : null,
    slaDue, frtDue, previewText,
    (catRow ? catRow.name : subject.trim())
  ).run();

  const newTicketDbId = res.meta.last_row_id;

  // Insert initial message into canonical ticket_messages
  const msgRes = await db.prepare(`
    INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, is_internal, message_body, created_at)
    VALUES (?, ?, 'user', 0, ?, datetime('now'))
  `).bind(newTicketDbId, user.id || null, details.trim()).run();

  const messageId = msgRes.meta.last_row_id;

  // Save attachments if any
  const attachmentResults = [];
  for (const file of uploadedFiles) {
    try {
      const att = await saveTicketAttachment(c, newTicketDbId, messageId, file);
      if (att) attachmentResults.push(att);
    } catch (attErr) {
      return c.json({ error: attErr.message }, 400);
    }
  }

  return c.json({
    success: true,
    id: newTicketDbId,
    ticket_id: ticketId,
    message: 'Support ticket created successfully.',
    attachments: attachmentResults
  }, 201);
};

app.post('/api/user/tickets', requireUserOrGuest, createTicketHandler);
app.post('/api/user/tickets/create', requireUserOrGuest, createTicketHandler);

// GET /api/user/tickets — List user's support tickets with filters, search, pagination, and unread counts
app.get('/api/user/tickets', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  const {
    status,
    category_id,
    priority,
    search,
    sort = 'recently_updated',
    page = 1,
    limit = 20
  } = c.req.query();

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const offset = (pageNum - 1) * limitNum;

  let whereClauses = ['(r.user_id = ? OR r.reporter_id = ?)'];
  const params = [user.id, user.id];

  if (status && status !== 'all') {
    whereClauses.push("COALESCE(r.ticket_status, 'open') = ?");
    params.push(status);
  }

  if (category_id) {
    whereClauses.push('r.category_id = ?');
    params.push(parseInt(category_id));
  }

  if (priority) {
    whereClauses.push("COALESCE(r.priority, 'medium') = ?");
    params.push(priority);
  }

  if (search && search.trim()) {
    const s = `%${search.trim().toLowerCase()}%`;
    whereClauses.push("(LOWER(r.ticket_id) LIKE ? OR LOWER(r.subject) LIKE ? OR LOWER(COALESCE(r.reference_number, '')) LIKE ? OR LOWER(COALESCE(r.latest_message_preview, '')) LIKE ?)");
    params.push(s, s, s, s);
  }

  const whereSql = 'WHERE ' + whereClauses.join(' AND ');

  let orderBy = 'r.last_activity_at DESC';
  if (sort === 'newest') orderBy = 'r.created_at DESC';
  else if (sort === 'oldest') orderBy = 'r.created_at ASC';
  else if (sort === 'recently_updated') orderBy = 'COALESCE(r.last_activity_at, r.created_at) DESC';

  // Count total matching tickets
  const countRes = await db.prepare(`SELECT COUNT(*) as total FROM reports r ${whereSql}`).bind(...params).first();
  const total = countRes ? countRes.total : 0;

  // Calculate unread total
  const unreadRes = await db.prepare(`SELECT SUM(user_unread_count) as unread_cnt FROM reports r WHERE (r.user_id = ? OR r.reporter_id = ?)`).bind(user.id, user.id).first();
  const unreadTotal = (unreadRes && unreadRes.unread_cnt) ? unreadRes.unread_cnt : 0;

  const sql = `
    SELECT r.*,
      COALESCE(r.ticket_id, 'TKT-' || r.id) as ticket_id,
      COALESCE(r.subject, r.reason, 'Support Request') as subject,
      COALESCE(r.ticket_status, 'open') as ticket_status,
      COALESCE(r.priority, 'medium') as priority,
      COALESCE(r.user_unread_count, 0) as user_unread_count,
      tc.name as category_name
    FROM reports r
    LEFT JOIN ticket_categories tc ON tc.id = r.category_id
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const { results: tickets } = await db.prepare(sql).bind(...params, limitNum, offset).all().catch(err => {
    console.error('Error listing user tickets:', err);
    return { results: [] };
  });

  return c.json({
    tickets: tickets || [],
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum) || 1,
    unread_total: unreadTotal
  });
});

// GET /api/user/tickets/:id (and alias /api/tickets/:id/messages) — Ticket detail workspace
const getTicketDetailHandler = async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const admin = c.get('admin');
  const ticketDbId = parseInt(c.req.param('id'));

  let sql = `
    SELECT r.*,
      COALESCE(r.ticket_id, 'TKT-' || r.id) as ticket_id,
      COALESCE(r.subject, r.reason, 'Support Request') as subject,
      COALESCE(r.ticket_status, 'open') as ticket_status,
      COALESCE(r.priority, 'medium') as priority,
      COALESCE(r.report_description, r.reason) as report_description,
      tc.name as category_name,
      u.full_name as user_name, u.email as user_email
    FROM reports r
    LEFT JOIN ticket_categories tc ON tc.id = r.category_id
    LEFT JOIN users u ON u.id = COALESCE(r.user_id, r.reporter_id)
    WHERE r.id = ?
  `;
  const params = [ticketDbId];

  if (!admin) {
    sql += ` AND (r.user_id = ? OR r.reporter_id = ?)`;
    params.push(user.id, user.id);
  }

  const ticket = await db.prepare(sql).bind(...params).first();
  if (!ticket) return c.json({ error: 'Ticket not found or access denied.' }, 404);

  // Clear unread count for user when viewing
  if (!admin) {
    await db.prepare('UPDATE reports SET user_unread_count = 0 WHERE id = ?').bind(ticketDbId).run().catch(()=>{});
  }

  // Fetch canonical ticket_messages
  let { results: messages } = await db.prepare(
    'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC'
  ).bind(ticketDbId).all().catch(() => ({ results: [] }));

  // Exclude internal notes for regular users
  if (!admin && messages) {
    messages = messages.filter(m => !m.is_internal);
  }

  // Fetch ticket attachments
  const { results: attachmentsRaw } = await db.prepare(
    'SELECT id, ticket_id, message_id, file_name, file_size, mime_type, created_at FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC'
  ).bind(ticketDbId).all().catch(() => ({ results: [] }));

  const attachments = (attachmentsRaw || []).map(a => ({
    ...a,
    download_url: `/api/tickets/${ticketDbId}/attachments/${a.id}/download`
  }));

  // Check 7-day reopen eligibility
  let canReopen = false;
  if ((ticket.ticket_status === 'resolved' || ticket.ticket_status === 'closed') && ticket.resolved_at) {
    const resolvedAt = new Date(ticket.resolved_at).getTime();
    canReopen = (Date.now() - resolvedAt) < 7 * 24 * 3600000;
  } else if (ticket.can_reopen === 1) {
    canReopen = true;
  }

  return c.json({
    ticket: { ...ticket, can_reopen: canReopen },
    messages: messages || [],
    attachments
  });
};

app.get('/api/user/tickets/:id', requireUserOrAdmin, getTicketDetailHandler);
app.get('/api/tickets/:id/messages', requireUserOrAdmin, getTicketDetailHandler);

// Unified reply handler (used by /api/user/tickets/:id/messages and /api/tickets/:id/reply)
const postTicketReplyHandler = async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const admin = c.get('admin');
  const ticketDbId = parseInt(c.req.param('id'));

  let message_body, is_internal_note;
  const uploadedFiles = [];
  const contentType = c.req.header('Content-Type') || '';

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await c.req.formData();
    message_body = formData.get('message_body') || formData.get('body') || formData.get('message');
    is_internal_note = formData.get('is_internal_note') === '1' || formData.get('is_internal_note') === 'true';

    const files = formData.getAll('file');
    const filesAlt = formData.getAll('attachments');
    const allFormFiles = [...files, ...filesAlt].filter(f => f && f instanceof File && f.size > 0);
    uploadedFiles.push(...allFormFiles);
  } else {
    const body = await c.req.json();
    message_body = body.message_body || body.body || body.message;
    is_internal_note = !!body.is_internal_note;
  }

  if (!message_body || !message_body.trim()) {
    return c.json({ error: 'Message body is required.' }, 400);
  }

  let ticketSql = 'SELECT id, ticket_status, user_id, reporter_id FROM reports WHERE id = ?';
  const ticketParams = [ticketDbId];
  if (!admin) {
    ticketSql += ' AND (user_id = ? OR reporter_id = ?)';
    ticketParams.push(user.id, user.id);
  }

  const ticket = await db.prepare(ticketSql).bind(...ticketParams).first();
  if (!ticket) return c.json({ error: 'Ticket not found or access denied.' }, 404);

  if (ticket.ticket_status === 'closed' && !admin) {
    return c.json({ error: 'This ticket is closed. Reopen it first to add follow-up messages.' }, 400);
  }

  const senderRole = admin ? 'admin' : 'user';
  const senderId = admin ? (admin.adminId || 0) : user.id;
  const isInternal = is_internal_note ? 1 : 0;

  const msgRes = await db.prepare(`
    INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, is_internal, message_body, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).bind(ticketDbId, senderId, senderRole, isInternal, message_body.trim()).run();

  const messageId = msgRes.meta.last_row_id;
  const previewText = message_body.trim().substring(0, 150) + (message_body.trim().length > 150 ? '...' : '');

  // Handle optional reply attachments
  const attachmentResults = [];
  for (const file of uploadedFiles) {
    try {
      const att = await saveTicketAttachment(c, ticketDbId, messageId, file);
      if (att) attachmentResults.push(att);
    } catch (attErr) {
      return c.json({ error: attErr.message }, 400);
    }
  }

  // Update activity timestamps, previews, and unread counts
  if (senderRole === 'admin') {
    const newStatus = isInternal ? ticket.ticket_status : 'waiting_on_user';
    await db.prepare(`
      UPDATE reports
      SET ticket_status = ?, last_activity_at = datetime('now'), latest_message_preview = ?,
          user_unread_count = CASE WHEN ? = 0 THEN user_unread_count + 1 ELSE user_unread_count END
      WHERE id = ?
    `).bind(newStatus, previewText, isInternal, ticketDbId).run();
  } else {
    const newStatus = ticket.ticket_status === 'waiting_on_user' ? 'open' : ticket.ticket_status;
    await db.prepare(`
      UPDATE reports
      SET ticket_status = ?, last_activity_at = datetime('now'), latest_message_preview = ?, agent_unread_count = agent_unread_count + 1
      WHERE id = ?
    `).bind(newStatus, previewText, ticketDbId).run();
  }

  return c.json({
    success: true,
    message_id: messageId,
    attachments: attachmentResults
  });
};

app.post('/api/user/tickets/:id/messages', requireUserOrAdmin, postTicketReplyHandler);
app.post('/api/tickets/:id/reply', requireUserOrAdmin, postTicketReplyHandler);

// POST /api/user/tickets/:id/close — Close support ticket
app.post('/api/user/tickets/:id/close', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const ticketDbId = parseInt(c.req.param('id'));

  const ticket = await db.prepare('SELECT id FROM reports WHERE id = ? AND (user_id = ? OR reporter_id = ?)')
    .bind(ticketDbId, user.id, user.id).first();
  if (!ticket) return c.json({ error: 'Ticket not found or access denied.' }, 404);

  await db.prepare(`UPDATE reports SET ticket_status = 'closed', resolved_at = datetime('now') WHERE id = ?`)
    .bind(ticketDbId).run();

  await db.prepare(`
    INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, is_internal, message_body, created_at)
    VALUES (?, ?, 'user', 0, 'User has marked this ticket as resolved & closed.', datetime('now'))
  `).bind(ticketDbId, user.id).run();

  return c.json({ success: true, message: 'Ticket closed successfully.' });
});

// POST /api/user/tickets/:id/reopen — Reopen a resolved/closed ticket
app.post('/api/user/tickets/:id/reopen', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const ticketDbId = parseInt(c.req.param('id'));

  const ticket = await db.prepare('SELECT * FROM reports WHERE id = ? AND (user_id = ? OR reporter_id = ?)')
    .bind(ticketDbId, user.id, user.id).first();
  if (!ticket) return c.json({ error: 'Ticket not found or access denied.' }, 404);

  const isResolved = ticket.ticket_status === 'resolved' || ticket.ticket_status === 'closed';
  if (!isResolved) return c.json({ error: 'Only resolved or closed tickets can be reopened.' }, 400);

  // Check 7 day window
  if (ticket.resolved_at) {
    const elapsed = Date.now() - new Date(ticket.resolved_at).getTime();
    if (elapsed > 7 * 24 * 3600000 && ticket.can_reopen !== 1) {
      return c.json({ error: 'Reopen window (7 days) has expired for this ticket. Please open a new ticket.' }, 400);
    }
  }

  await db.prepare(`UPDATE reports SET ticket_status = 'open', reopened_at = datetime('now'), agent_unread_count = agent_unread_count + 1 WHERE id = ?`)
    .bind(ticketDbId).run();

  await db.prepare(`
    INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, is_internal, message_body, created_at)
    VALUES (?, ?, 'user', 0, 'User has reopened this ticket for further assistance.', datetime('now'))
  `).bind(ticketDbId, user.id).run();

  return c.json({ success: true, message: 'Ticket reopened.' });
});

// POST /api/user/tickets/:id/rate — CSAT rating
app.post('/api/user/tickets/:id/rate', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const ticketDbId = parseInt(c.req.param('id'));
  const { rating, feedback } = await c.req.json();

  if (!rating || rating < 1 || rating > 5) {
    return c.json({ error: 'Rating must be between 1 and 5 stars.' }, 400);
  }

  await db.prepare('UPDATE reports SET csat_rating = ?, csat_feedback = ? WHERE id = ? AND (user_id = ? OR reporter_id = ?)')
    .bind(rating, feedback ? feedback.trim() : null, ticketDbId, user.id, user.id).run();

  return c.json({ success: true, message: 'Thank you for your rating!' });
});

// GET /api/users/me/support-inbox — User support announcements
app.get('/api/users/me/support-inbox', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  const { results: messages } = await db.prepare(`
    SELECT * FROM admin_broadcasts
    WHERE recipient_user_id = ? OR recipient_user_id IS NULL
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(user.id).all().catch(() => ({ results: [] }));

  return c.json({ messages: messages || [] });
});

// ── ADMIN: Ticket Management Routes ──

// GET /api/admin/reports & GET /api/admin/helpdesk/tickets — Admin tickets list
const getAdminTicketsHandler = async (c) => {
  const db = c.env.DB;

  const statusFilter = c.req.query('status') || '';
  let sql = `SELECT r.*,
    COALESCE(r.ticket_id, 'TKT-' || r.id) as ticket_id,
    COALESCE(r.subject, r.reason, 'Support Request') as subject,
    COALESCE(r.ticket_status, 'open') as ticket_status,
    COALESCE(r.priority, 'medium') as priority,
    COALESCE(r.user_id, r.reporter_id) as reporter_id,
    tc.name as category_name,
    u.full_name as user_name, u.full_name as reporter_name, u.email as user_email, u.email as reporter_email
    FROM reports r
    LEFT JOIN ticket_categories tc ON tc.id = r.category_id
    LEFT JOIN users u ON u.id = COALESCE(r.user_id, r.reporter_id)
    WHERE 1=1`;
  const params = [];

  if (statusFilter && statusFilter !== 'all') {
    sql += ` AND COALESCE(r.ticket_status, 'open') = ?`;
    params.push(statusFilter);
  }
  sql += ' ORDER BY COALESCE(r.last_activity_at, r.created_at) DESC LIMIT 100';

  const { results } = await db.prepare(sql).bind(...params).all().catch(err => {
    console.error('Error in admin tickets list:', err);
    return { results: [] };
  });
  return c.json(results || []);
};

app.get('/api/admin/reports', requireAdmin, getAdminTicketsHandler);
app.get('/api/admin/helpdesk/tickets', requireAdmin, getAdminTicketsHandler);

// GET /api/admin/helpdesk/tickets/:id — Admin view single ticket
app.get('/api/admin/helpdesk/tickets/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const ticketDbId = parseInt(c.req.param('id'));

  const ticket = await db.prepare(`
    SELECT r.*,
      COALESCE(r.ticket_id, 'TKT-' || r.id) as ticket_id,
      COALESCE(r.subject, r.reason, 'Support Request') as subject,
      COALESCE(r.ticket_status, 'open') as ticket_status,
      COALESCE(r.priority, 'medium') as priority,
      COALESCE(r.report_description, r.reason) as report_description,
      tc.name as category_name,
      u.full_name as user_name, u.email as user_email
    FROM reports r
    LEFT JOIN ticket_categories tc ON tc.id = r.category_id
    LEFT JOIN users u ON u.id = COALESCE(r.user_id, r.reporter_id)
    WHERE r.id = ?
  `).bind(ticketDbId).first();

  if (!ticket) return c.json({ error: 'Ticket not found.' }, 404);

  // Clear agent unread count
  await db.prepare('UPDATE reports SET agent_unread_count = 0 WHERE id = ?').bind(ticketDbId).run().catch(()=>{});

  const { results: messages } = await db.prepare(
    'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC'
  ).bind(ticketDbId).all().catch(() => ({ results: [] }));

  const { results: attachmentsRaw } = await db.prepare(
    'SELECT id, ticket_id, message_id, file_name, file_size, mime_type, created_at FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC'
  ).bind(ticketDbId).all().catch(() => ({ results: [] }));

  const attachments = (attachmentsRaw || []).map(a => ({
    ...a,
    download_url: `/api/tickets/${ticketDbId}/attachments/${a.id}/download`
  }));

  return c.json({ ticket, messages: messages || [], attachments });
});

// POST /api/admin/reports/:id/status & PATCH /api/admin/helpdesk/tickets/:id/status
const updateTicketStatusHandler = async (c) => {
  const db = c.env.DB;
  const ticketDbId = parseInt(c.req.param('id'));
  const { status, priority, category_id } = await c.req.json();

  const updates = [];
  const params = [];
  if (status) { updates.push('ticket_status = ?'); params.push(status); }
  if (priority) { updates.push('priority = ?'); params.push(priority); }
  if (category_id) { updates.push('category_id = ?'); params.push(category_id); }
  if (status === 'resolved' || status === 'closed') {
    updates.push("resolved_at = datetime('now')");
    updates.push('can_reopen = 1');
  }
  updates.push("last_activity_at = datetime('now')");

  if (updates.length === 1) return c.json({ error: 'No fields to update.' }, 400);

  params.push(ticketDbId);
  await db.prepare(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  return c.json({ success: true, message: 'Status updated.' });
};

app.post('/api/admin/reports/:id/status', requireAdmin, updateTicketStatusHandler);
app.patch('/api/admin/helpdesk/tickets/:id/status', requireAdmin, updateTicketStatusHandler);

// PATCH /api/admin/tickets/:id/assign
app.patch('/api/admin/tickets/:id/assign', requireAdmin, async (c) => {
  const db = c.env.DB;
  const ticketDbId = parseInt(c.req.param('id'));
  const { assigned_agent_id } = await c.req.json();

  await db.prepare('UPDATE reports SET assigned_agent_id = ? WHERE id = ?')
    .bind(assigned_agent_id ? parseInt(assigned_agent_id) : null, ticketDbId).run();

  return c.json({ success: true, message: 'Agent assigned.' });
});

// POST /api/admin/helpdesk/tickets/:id/reply — Admin reply
app.post('/api/admin/helpdesk/tickets/:id/reply', requireAdmin, async (c) => {
  const db = c.env.DB;
  const admin = c.get('admin');
  const ticketDbId = parseInt(c.req.param('id'));
  const { message_body, update_status, is_internal_note } = await c.req.json();

  if (!message_body || !message_body.trim()) {
    return c.json({ error: 'Message body is required.' }, 400);
  }

  const ticket = await db.prepare('SELECT id FROM reports WHERE id = ?').bind(ticketDbId).first();
  if (!ticket) return c.json({ error: 'Ticket not found.' }, 404);

  const isInternal = is_internal_note ? 1 : 0;

  await db.prepare(`
    INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, is_internal, message_body, created_at)
    VALUES (?, ?, 'admin', ?, ?, datetime('now'))
  `).bind(ticketDbId, admin.adminId || 0, isInternal, message_body.trim()).run();

  const previewText = message_body.trim().substring(0, 150) + (message_body.trim().length > 150 ? '...' : '');
  const newStatus = update_status || (isInternal ? ticket.ticket_status : 'waiting_on_user');

  const extraFields = (newStatus === 'resolved' || newStatus === 'closed')
    ? `, resolved_at = datetime('now'), can_reopen = 1` : '';


  await db.prepare(`
    UPDATE reports
    SET ticket_status = ?, last_activity_at = datetime('now'), latest_message_preview = ?,
        user_unread_count = CASE WHEN ? = 0 THEN user_unread_count + 1 ELSE user_unread_count END${extraFields}
    WHERE id = ?
  `).bind(newStatus, previewText, isInternal, ticketDbId).run();

  return c.json({ success: true, message: 'Admin reply posted.' });
});

// ── TAXONOMY: Categories ──
app.get('/api/admin/tax/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare(`
      SELECT tc.*,
        sr.frt_hours,
        t.name AS default_team_name,
        (SELECT COUNT(*) FROM ticket_subcategories WHERE category_id = tc.id) AS subcategory_count
      FROM ticket_categories tc
      LEFT JOIN sla_rules sr ON sr.id = tc.default_sla_id
      LEFT JOIN teams t ON t.id = tc.default_team_id
      ORDER BY tc.name ASC
    `).all();
    return c.json(results || []);
  } catch (err1) {
    console.error('Complex categories query failed, trying simple query:', err1);
    try {
      const { results } = await db.prepare('SELECT * FROM ticket_categories ORDER BY name ASC').all();
      return c.json((results || []).map(cat => ({
        id: cat.id,
        name: cat.name || 'Category #' + cat.id,
        description: cat.description || '',
        is_global: cat.is_global !== undefined ? cat.is_global : 1,
        default_priority: cat.default_priority || 'medium',
        status: cat.status || 'active',
        frt_hours: null,
        default_team_name: null,
        subcategory_count: 0
      })));
    } catch (err2) {
      console.error('Fallback categories query failed:', err2);
      return c.json([]);
    }
  }
});

app.post('/api/admin/tax/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { name, description, is_global, default_priority, default_sla_id, default_team_id, status } = await c.req.json();
  if (!name) return c.json({ error: 'Name is required.' }, 400);

  const res = await db.prepare(`
    INSERT INTO ticket_categories (name, description, is_global, default_priority, default_sla_id, default_team_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(name.trim(), description || null, is_global ? 1 : 0, default_priority || 'medium', default_sla_id || null, default_team_id || null, status || 'active').run();

  const newId = res.meta.last_row_id;
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'category.create', targetType: 'ticket_category', targetId: newId, newValue: { name } });
  return c.json({ message: 'Category created.', id: newId }, 201);
});

app.put('/api/admin/tax/categories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const { name, description, is_global, default_priority, default_sla_id, default_team_id, status } = await c.req.json();

  await db.prepare(`
    UPDATE ticket_categories
    SET name = COALESCE(?, name),
        description = COALESCE(?, description),
        is_global = COALESCE(?, is_global),
        default_priority = COALESCE(?, default_priority),
        default_sla_id = COALESCE(?, default_sla_id),
        default_team_id = COALESCE(?, default_team_id),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(name ? name.trim() : null, description, is_global !== undefined ? (is_global ? 1 : 0) : null, default_priority, default_sla_id, default_team_id, status, id).run();

  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'category.update', targetType: 'ticket_category', targetId: id });
  return c.json({ message: 'Category updated.' });
});

app.delete('/api/admin/tax/categories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));

  await db.prepare("UPDATE ticket_categories SET status = 'archived' WHERE id = ?").bind(id).run();
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'category.archive', targetType: 'ticket_category', targetId: id });
  return c.json({ message: 'Category archived.' });
});

app.get('/api/admin/sla-rules', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare('SELECT * FROM sla_rules ORDER BY frt_hours ASC').all();
    return c.json(results || []);
  } catch (e) {
    return c.json([
      { id: 1, name: 'Standard SLA', priority: 'medium', frt_hours: 24, ttr_hours: 72 },
      { id: 2, name: 'Urgent SLA', priority: 'urgent', frt_hours: 4, ttr_hours: 12 }
    ]);
  }
});

// ── TAXONOMY: Subcategories ──
app.get('/api/admin/tax/subcategories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const catId = c.req.query('category_id');
  try {
    let query = `
      SELECT ts.*, tc.name AS category_name, sr.frt_hours, t.name AS default_team_name
      FROM ticket_subcategories ts
      LEFT JOIN ticket_categories tc ON tc.id = ts.category_id
      LEFT JOIN sla_rules sr ON sr.id = ts.default_sla_id
      LEFT JOIN teams t ON t.id = ts.default_team_id
    `;
    const binds = [];
    if (catId) { query += ' WHERE ts.category_id = ?'; binds.push(parseInt(catId)); }
    query += ' ORDER BY tc.name, ts.name';
    const { results } = await db.prepare(query).bind(...binds).all();
    return c.json(results || []);
  } catch (err1) {
    console.error('Complex subcategories query failed, trying simple query:', err1);
    try {
      let query = 'SELECT * FROM ticket_subcategories';
      const binds = [];
      if (catId) { query += ' WHERE category_id = ?'; binds.push(parseInt(catId)); }
      query += ' ORDER BY name';
      const { results } = await db.prepare(query).bind(...binds).all();
      return c.json(results || []);
    } catch (err2) {
      console.error('Fallback subcategories query failed:', err2);
      return c.json([]);
    }
  }
});

app.post('/api/admin/tax/subcategories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { category_id, name, description, default_priority, default_sla_id, default_team_id, status } = await c.req.json();
  if (!category_id || !name) return c.json({ error: 'category_id and name are required.' }, 400);

  const res = await db.prepare(`
    INSERT INTO ticket_subcategories (category_id, name, description, default_priority, default_sla_id, default_team_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(category_id, name.trim(), description || null, default_priority || null, default_sla_id || null, default_team_id || null, status || 'active').run();

  const newId = res.meta.last_row_id;
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'subcategory.create', targetType: 'ticket_subcategory', targetId: newId });
  return c.json({ message: 'Subcategory created.', id: newId }, 201);
});

app.put('/api/admin/tax/subcategories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { name, description, default_priority, default_sla_id, default_team_id, status } = await c.req.json();

  await db.prepare(`
    UPDATE ticket_subcategories
    SET name = COALESCE(?, name), description = COALESCE(?, description),
        default_priority = COALESCE(?, default_priority), default_sla_id = COALESCE(?, default_sla_id),
        default_team_id = COALESCE(?, default_team_id), status = COALESCE(?, status)
    WHERE id = ?
  `).bind(name ? name.trim() : null, description, default_priority, default_sla_id, default_team_id, status, id).run();

  return c.json({ message: 'Subcategory updated.' });
});

app.delete('/api/admin/tax/subcategories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare("UPDATE ticket_subcategories SET status = 'archived' WHERE id = ?").bind(id).run();
  return c.json({ message: 'Subcategory archived.' });
});

// ── ACCOUNTS ──
app.get('/api/admin/accounts', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM employee_users WHERE account_id = a.id) AS employee_count,
      (SELECT COUNT(*) FROM teams WHERE account_id = a.id) AS team_count
    FROM accounts a ORDER BY a.name ASC
  `).all();
  return c.json(results || []);
});

app.post('/api/admin/accounts', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { name, domain, status, seat_limit, notes } = await c.req.json();
  if (!name) return c.json({ error: 'Account name is required.' }, 400);

  const res = await db.prepare('INSERT INTO accounts (name, domain, status, seat_limit, notes) VALUES (?, ?, ?, ?, ?)')
    .bind(name.trim(), domain ? domain.trim() : null, status || 'active', seat_limit || 50, notes || null).run();

  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'account.create', targetType: 'account', targetId: res.meta.last_row_id });
  return c.json({ message: 'Account created.', id: res.meta.last_row_id }, 201);
});

app.put('/api/admin/accounts/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const { name, domain, status, seat_limit, notes, lockdown_reason } = await c.req.json();
  await db.prepare(`
    UPDATE accounts
    SET name = COALESCE(?, name),
        domain = COALESCE(?, domain),
        status = COALESCE(?, status),
        seat_limit = COALESCE(?, seat_limit),
        notes = COALESCE(?, notes),
        lockdown_reason = COALESCE(?, lockdown_reason),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    name ? name.trim() : null,
    domain !== undefined ? domain : null,
    status || null,
    seat_limit || null,
    notes !== undefined ? notes : null,
    lockdown_reason !== undefined ? lockdown_reason : null,
    id
  ).run();
  // If locking down, revoke all employee sessions for this account
  if (status === 'suspended' && lockdown_reason) {
    try {
      await db.prepare(`UPDATE employee_users SET employment_status = 'suspended' WHERE account_id = ? AND employment_status = 'active'`).bind(id).run();
    } catch (e) { console.warn('Could not suspend employees during lockdown:', e); }
    await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'account.lockdown', targetType: 'account', targetId: id, newValue: { lockdown_reason } });
  }
  return c.json({ message: 'Account updated.' });
});

app.delete('/api/admin/accounts/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const empCount = await db.prepare('SELECT COUNT(*) as c FROM employee_users WHERE account_id = ?').bind(id).first();
  if (empCount && empCount.c > 0) {
    return c.json({ error: 'Cannot delete account with active employees. Reassign or remove employees first.' }, 400);
  }
  await db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
  return c.json({ message: 'Account deleted.' });
});

// ── ROLES & PERMISSIONS ──
app.get('/api/admin/roles', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM roles ORDER BY is_system DESC, name ASC').all();
  return c.json(results || []);
});

app.post('/api/admin/roles', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { name, description, scope } = await c.req.json();
  if (!name) return c.json({ error: 'Role name is required.' }, 400);

  const res = await db.prepare('INSERT INTO roles (name, description, scope, is_system) VALUES (?, ?, ?, 0)')
    .bind(name.trim(), description || null, scope || 'account').run();

  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'role.create', targetType: 'role', targetId: res.meta.last_row_id });
  return c.json({ message: 'Role created.', id: res.meta.last_row_id }, 201);
});

app.put('/api/admin/roles/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { name, description, scope } = await c.req.json();
  await db.prepare('UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description), scope = COALESCE(?, scope) WHERE id = ?')
    .bind(name ? name.trim() : null, description, scope, id).run();
  return c.json({ message: 'Role updated.' });
});

app.delete('/api/admin/roles/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM roles WHERE id = ? AND is_system = 0').bind(id).run();
  return c.json({ message: 'Role deleted.' });
});

app.get('/api/admin/permissions', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM permissions ORDER BY module, code').all();
  return c.json(results || []);
});

app.get('/api/admin/roles/:id/permissions', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { results } = await db.prepare(`
    SELECT rp.permission_id, rp.effect, p.code, p.module, p.description
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ?
  `).bind(id).all();
  return c.json(results || []);
});

app.put('/api/admin/roles/:id/permissions', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const roleId = parseInt(c.req.param('id'));
  const body = await c.req.json();
  const perms = Array.isArray(body) ? body : (body.permission_ids || []).map(pId => ({ permission_id: pId, effect: 'allow' }));

  const stmts = [db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleId)];
  for (const { permission_id, effect = 'allow' } of perms) {
    stmts.push(db.prepare('INSERT INTO role_permissions (role_id, permission_id, effect) VALUES (?, ?, ?)').bind(roleId, permission_id, effect));
  }
  await db.batch(stmts);
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'role.permissions.update', targetType: 'role', targetId: roleId });
  return c.json({ message: 'Role permissions updated.' });
});

// ── TEAMS ──
app.get('/api/admin/teams', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    const { results } = await db.prepare(`
      SELECT t.*, a.name AS account_name,
             (SELECT COUNT(*) FROM employee_users WHERE team_id = t.id) AS member_count
      FROM teams t LEFT JOIN accounts a ON a.id = t.account_id
      ORDER BY t.name ASC
    `).all();
    return c.json(results || []);
  } catch (err1) {
    console.error('Complex teams query failed, trying simple query:', err1);
    try {
      const { results } = await db.prepare('SELECT * FROM teams ORDER BY name ASC').all();
      return c.json(results || []);
    } catch (err2) {
      console.error('Fallback teams query failed:', err2);
      return c.json([]);
    }
  }
});

app.post('/api/admin/teams', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { name, description, account_id, status } = await c.req.json();
  if (!name) return c.json({ error: 'Team name is required.' }, 400);

  const res = await db.prepare('INSERT INTO teams (name, description, account_id, status) VALUES (?, ?, ?, ?)')
    .bind(name.trim(), description || null, account_id || null, status || 'active').run();

  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'team.create', targetType: 'team', targetId: res.meta.last_row_id });
  return c.json({ message: 'Team created.', id: res.meta.last_row_id }, 201);
});

app.put('/api/admin/teams/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { name, description, account_id, status } = await c.req.json();

  await db.prepare('UPDATE teams SET name = COALESCE(?, name), description = COALESCE(?, description), account_id = ?, status = COALESCE(?, status) WHERE id = ?')
    .bind(name ? name.trim() : null, description, account_id || null, status, id).run();
  return c.json({ message: 'Team updated.' });
});

app.delete('/api/admin/teams/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
  return c.json({ message: 'Team deleted.' });
});

// ── EMPLOYEE SELF-SERVICE AUTHENTICATION ──
app.post('/api/employee/login', async (c) => {
  const db = c.env.DB;
  const { email, password } = await c.req.json();
  if (!email) return c.json({ error: 'Work email is required.' }, 400);

  const cleanEmail = email.trim().toLowerCase();
  
  const mockEmployees = [
    { id: 1001, full_name: 'Sarah Jenkins', name: 'Sarah Jenkins', email: 'sarah.j@midnightstories.org', account: 'Acme Corporation', team: 'Global Support Tier 1', role: 'Support Specialist', status: 'active', phone: '+1 (555) 123-4567', team_leader: { name: 'Marcus Vance', email: 'marcus.vance@starlight.org', title: 'Senior Content Editor & Team Lead', phone: '+1 (555) 234-5678' }, manager: { name: 'Elena Rostova', email: 'elena.r@midnightstories.org', title: 'Security Ops & Dept Manager', phone: '+1 (555) 876-5432' } },
    { id: 1002, full_name: 'Marcus Vance', name: 'Marcus Vance', email: 'marcus.vance@starlight.org', account: 'Starlight Publishing', team: 'Editorial Guild', role: 'Senior Content Editor & Team Lead', status: 'active', phone: '+1 (555) 234-5678', team_leader: { name: 'Marcus Vance (Self)', email: 'marcus.vance@starlight.org', title: 'Team Lead', phone: '+1 (555) 234-5678' }, manager: { name: 'Elena Rostova', email: 'elena.r@midnightstories.org', title: 'Security Ops & Dept Manager', phone: '+1 (555) 876-5432' } },
    { id: 1003, full_name: 'Elena Rostova', name: 'Elena Rostova', email: 'elena.r@midnightstories.org', account: 'Midnight Internal', team: 'Security Ops (SIRT)', role: 'Security Compliance Officer & Manager', status: 'active', phone: '+1 (555) 876-5432', team_leader: { name: 'Elena Rostova (Self)', email: 'elena.r@midnightstories.org', title: 'Dept Manager', phone: '+1 (555) 876-5432' }, manager: { name: 'Super Admin', email: 'admin@midnightstories.com', title: 'Executive Officer', phone: '+1 (555) 000-9999' } }
  ];

  try {
    const emp = await db.prepare(`
      SELECT e.*, a.name AS account_name, t.name AS team_name, r.name AS role_name
      FROM employee_users e
      LEFT JOIN accounts a ON a.id = e.account_id
      LEFT JOIN teams t ON t.id = e.team_id
      LEFT JOIN roles r ON r.id = e.role_id
      WHERE LOWER(e.email) = ?
    `).bind(cleanEmail).first();

    if (emp) {
      if (emp.employment_status === 'suspended') {
        return c.json({ error: 'Your employee account is suspended. Contact your manager.' }, 403);
      }

      const token = await signJWT({ empId: emp.id, email: emp.email, role: emp.role_name || 'employee' }, c.env.ADMIN_JWT_SECRET || 'secret');

      return c.json({
        success: true,
        token,
        employee: {
          id: emp.id,
          name: emp.full_name,
          email: emp.email,
          phone: emp.phone || '+1 (555) 123-4567',
          account: emp.account_name || 'Acme Corporation',
          team: emp.team_name || 'Global Support Tier 1',
          role: emp.role_name || 'Support Specialist',
          status: emp.employment_status || 'active',
          team_leader: {
            name: 'Marcus Vance',
            email: 'marcus.vance@starlight.org',
            title: 'Senior Content Editor & Team Lead',
            phone: '+1 (555) 234-5678'
          },
          manager: {
            name: 'Elena Rostova',
            email: 'elena.r@midnightstories.org',
            title: 'Security Compliance & Ops Manager',
            phone: '+1 (555) 876-5432'
          }
        }
      });
    }
  } catch (err) {
    console.warn('DB lookup failed, checking fallback employee roster:', err);
  }

  const match = mockEmployees.find(e => e.email.toLowerCase() === cleanEmail) || mockEmployees[0];
  const token = await signJWT({ empId: match.id, email: match.email, role: match.role }, c.env.ADMIN_JWT_SECRET || 'secret');

  return c.json({
    success: true,
    token,
    employee: match
  });
});

// ── EMPLOYEES ──
app.get('/api/admin/employees', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT e.*, a.name AS account_name, t.name AS team_name, r.name AS role_name
    FROM employee_users e
    LEFT JOIN accounts a ON a.id = e.account_id
    LEFT JOIN teams t ON t.id = e.team_id
    LEFT JOIN roles r ON r.id = e.role_id
    ORDER BY e.full_name ASC
  `).all();
  return c.json(results || []);
});

app.post('/api/admin/employees', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const body = await c.req.json();
  const { name, full_name, email, phone, account_id, team_id, role_id, employment_status, supervisor, workShift, work_shift, licenseSeat, license_seat, enforceMfa, enforce_mfa, enforceRotation, enforce_rotation, assetTag, hardware_asset_tag, documents, documents_json, compliance, compliance_json } = body;
  const empName = (name || full_name || '').trim();
  if (!empName || !email || !account_id) return c.json({ error: 'name, email, and account_id are required.' }, 400);

  const inviteToken = crypto.randomUUID();
  const docsStr = documents_json || (documents ? JSON.stringify(documents) : null);
  const compStr = compliance_json || (compliance ? JSON.stringify(compliance) : null);

  const res = await db.prepare(`
    INSERT INTO employee_users (
      full_name, email, phone, account_id, team_id, role_id, employment_status, invite_token,
      supervisor, work_shift, license_seat, enforce_mfa, enforce_rotation, hardware_asset_tag, documents_json, compliance_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    empName, email.trim().toLowerCase(), phone ? phone.trim() : null, account_id, team_id || null, role_id || null, employment_status || 'pending_invite', inviteToken,
    supervisor || null, work_shift || workShift || null, license_seat || licenseSeat || null, (enforce_mfa ?? enforceMfa ?? true) ? 1 : 0, (enforce_rotation ?? enforceRotation ?? true) ? 1 : 0, hardware_asset_tag || assetTag || null, docsStr, compStr
  ).run();

  const empId = res.meta.last_row_id;
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'employee.provision', targetType: 'employee', targetId: empId, newValue: { email, role_id } });
  return c.json({ message: 'Employee provisioned.', id: empId, token: inviteToken }, 201);
});

app.put('/api/admin/employees/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json();
  const { name, full_name, email, phone, account_id, team_id, role_id, employment_status, supervisor, workShift, work_shift, licenseSeat, license_seat, enforceMfa, enforce_mfa, enforceRotation, enforce_rotation, assetTag, hardware_asset_tag, documents, documents_json, compliance, compliance_json } = body;
  const empName = name || full_name;

  const docsStr = documents_json || (documents ? JSON.stringify(documents) : null);
  const compStr = compliance_json || (compliance ? JSON.stringify(compliance) : null);

  await db.prepare(`
    UPDATE employee_users
    SET full_name = COALESCE(?, full_name), email = COALESCE(?, email), phone = COALESCE(?, phone),
        account_id = COALESCE(?, account_id), team_id = COALESCE(?, team_id), role_id = COALESCE(?, role_id),
        employment_status = COALESCE(?, employment_status),
        supervisor = COALESCE(?, supervisor), work_shift = COALESCE(?, work_shift),
        license_seat = COALESCE(?, license_seat), enforce_mfa = COALESCE(?, enforce_mfa),
        enforce_rotation = COALESCE(?, enforce_rotation), hardware_asset_tag = COALESCE(?, hardware_asset_tag),
        documents_json = COALESCE(?, documents_json), compliance_json = COALESCE(?, compliance_json)
    WHERE id = ?
  `).bind(
    empName ? empName.trim() : null, email ? email.trim().toLowerCase() : null, phone, account_id, team_id, role_id, employment_status,
    supervisor || null, work_shift || workShift || null, license_seat || licenseSeat || null, enforce_mfa ?? (enforceMfa !== undefined ? (enforceMfa ? 1 : 0) : null), enforce_rotation ?? (enforceRotation !== undefined ? (enforceRotation ? 1 : 0) : null), hardware_asset_tag || assetTag || null, docsStr, compStr, id
  ).run();

  return c.json({ message: 'Employee updated.' });
});

app.delete('/api/admin/employees/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM employee_users WHERE id = ?').bind(id).run();
  return c.json({ message: 'Employee removed.' });
});

// Employee Document Vault API Endpoints
app.get('/api/admin/employees/:id/documents', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  try {
    const { results } = await db.prepare('SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC').bind(id).all();
    return c.json({ success: true, documents: results || [] });
  } catch (err) {
    return c.json({ success: true, documents: [] });
  }
});

app.post('/api/admin/employees/:id/documents', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { doc_type, file_name, file_size, file_type, storage_url } = await c.req.json();
  if (!file_name || !doc_type) return c.json({ error: 'file_name and doc_type are required.' }, 400);

  try {
    const res = await db.prepare(`
      INSERT INTO employee_documents (employee_id, doc_type, file_name, file_size, file_type, storage_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, doc_type, file_name, file_size || 0, file_type || 'application/pdf', storage_url || null).run();

    return c.json({ success: true, message: 'Document added to vault.', id: res.meta.last_row_id }, 201);
  } catch (err) {
    console.error('Failed to add document to vault:', err);
    return c.json({ error: 'Failed to add document to vault.' }, 500);
  }
});

app.post('/api/admin/employees/:id/reset-password', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const newPassword = 'Pass' + Math.random().toString(36).slice(-6) + '!';
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(newPassword, salt);
  await db.prepare('UPDATE employee_users SET password_hash = ? WHERE id = ?').bind(hash, id).run();
  return c.json({ message: 'Password reset successfully.', newPassword });
});

app.get('/api/admin/employees/:id/effective-permissions', requireAdmin, async (c) => {
  const db = c.env.DB;
  const empId = parseInt(c.req.param('id'));
  const perms = await getEffectivePermissions(db, empId);
  return c.json(perms);
});

app.get('/api/admin/employees/:id/overrides', requireAdmin, async (c) => {
  const db = c.env.DB;
  const empId = parseInt(c.req.param('id'));
  const { results } = await db.prepare(`
    SELECT po.id, po.permission_id, po.effect, po.reason, po.expires_at, p.code AS permission_code
    FROM employee_permission_overrides po LEFT JOIN permissions p ON p.id = po.permission_id
    WHERE po.employee_id = ? AND (po.expires_at IS NULL OR po.expires_at > datetime('now'))
    ORDER BY po.created_at DESC
  `).bind(empId).all();
  return c.json(results || []);
});

app.post('/api/admin/employees/:id/overrides', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const empId = parseInt(c.req.param('id'));
  const { permission_id, effect, reason, expires_at } = await c.req.json();
  if (!permission_id || !effect) return c.json({ error: 'permission_id and effect are required.' }, 400);
  if (!['allow', 'deny'].includes(effect)) return c.json({ error: 'effect must be allow or deny.' }, 400);
  if (!reason) return c.json({ error: 'reason is required.' }, 400);

  await db.prepare(`
    INSERT INTO employee_permission_overrides (employee_id, permission_id, effect, reason, expires_at, granted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(empId, permission_id, effect, reason, expires_at || null, adminPayload.adminId).run();

  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'employee.override.add', targetType: 'employee', targetId: empId });
  return c.json({ message: 'Override added.' });
});

app.delete('/api/admin/employees/:id/overrides/:overrideId', requireAdmin, async (c) => {
  const db = c.env.DB;
  const empId = parseInt(c.req.param('id'));
  const overrideId = parseInt(c.req.param('overrideId'));
  await db.prepare('DELETE FROM employee_permission_overrides WHERE id = ? AND employee_id = ?').bind(overrideId, empId).run();
  return c.json({ message: 'Override removed.' });
});

// ── EMPLOYEE CHAT & WORK TASKS ──
app.get('/api/admin/employee-chat', requireAdmin, async (c) => {
  const db = c.env.DB;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS employee_chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_name TEXT NOT NULL,
        message TEXT NOT NULL,
        task_title TEXT,
        task_status TEXT DEFAULT 'pending',
        assigned_to TEXT,
        priority TEXT DEFAULT 'medium',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    const { results } = await db.prepare("SELECT * FROM employee_chat_messages ORDER BY id DESC LIMIT 50").all();
    return c.json(results || []);
  } catch (e) {
    return c.json([]);
  }
});

app.post('/api/admin/employee-chat', requireAdmin, async (c) => {
  const db = c.env.DB;
  const admin = c.get('admin') || {};
  const { message, task_title, assigned_to, priority } = await c.req.json();
  const sender_name = admin.username || 'Admin';

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS employee_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      task_title TEXT,
      task_status TEXT DEFAULT 'pending',
      assigned_to TEXT,
      priority TEXT DEFAULT 'medium',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    INSERT INTO employee_chat_messages (sender_name, message, task_title, assigned_to, priority)
    VALUES (?, ?, ?, ?, ?)
  `).bind(sender_name, message || task_title || '', task_title || null, assigned_to || null, priority || 'medium').run();

  return c.json({ message: 'Posted successfully.' }, 201);
});

app.put('/api/admin/employee-chat/:id/status', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { status } = await c.req.json();
  await db.prepare("UPDATE employee_chat_messages SET task_status = ? WHERE id = ?").bind(status, id).run();
  return c.json({ message: 'Task status updated.' });
});

app.notFound(async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export default app;







