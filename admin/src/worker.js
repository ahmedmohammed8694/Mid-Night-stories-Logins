// admin/src/worker.js — Dedicated Admin Worker for Midnight Stories
// Deploys to: https://admin.midnightstories.dpdns.org/
// Connects to the same D1 database as the main public site.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { getEffectivePermissions, hasPermission, writeAuditLog } from './permissions.js';

// ── Native JWT using Web Crypto API ──
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

// ── IP Hash Helper ──
async function hashIP(ip) {
  const enc = new TextEncoder();
  const data = enc.encode(ip + 'midnight_stories_salt_2026');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Moderation Helpers ──
function moderateText(text, bannedKeywords = []) {
  let flags = [];
  let autoAction = 'approve';

  const lower = text.toLowerCase();
  for (const kw of bannedKeywords) {
    if (lower.includes(kw.toLowerCase())) {
      flags.push(`banned_keyword:${kw}`);
      autoAction = 'reject';
    }
  }

  // PII detection
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const ssnRegex = /\d{3}-\d{2}-\d{4}/g;

  const emails = text.match(emailRegex) || [];
  const phones = text.match(phoneRegex) || [];
  const ssns = text.match(ssnRegex) || [];

  let redactedText = text;
  for (const e of emails) { redactedText = redactedText.replace(e, '[EMAIL REDACTED]'); flags.push('pii:email'); }
  for (const p of phones) { redactedText = redactedText.replace(p, '[PHONE REDACTED]'); flags.push('pii:phone'); }
  for (const s of ssns) { redactedText = redactedText.replace(s, '[SSN REDACTED]'); flags.push('pii:ssn'); }

  return { flags, autoAction, redactedText };
}

function detectCrisisLanguage(text) {
  const crisisPatterns = [
    /kill\s*(my)?self/i, /suicide/i, /end\s*it\s*all/i, /don'?t\s*want\s*to\s*live/i,
    /want\s*to\s*die/i, /better\s*off\s*dead/i, /no\s*reason\s*to\s*live/i,
    /kys/i, /end\s*my\s*life/i
  ];
  for (const pattern of crisisPatterns) {
    if (pattern.test(text)) {
      return { isCrisis: true, severity: 'high', pattern: pattern.source };
    }
  }
  return { isCrisis: false };
}

// ── Rate Limiting ──
const rateLimitMap = new Map();

function rateLimit(type, maxPerHour) {
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') || '127.0.0.1';
    const key = `${type}:${ip}`;
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;

    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, []);
    }

    const timestamps = rateLimitMap.get(key).filter(t => now - t < windowMs);
    if (timestamps.length >= maxPerHour) {
      return c.json({
        error: 'Rate limit exceeded',
        message: `You can only make ${maxPerHour} ${type} requests per hour.`,
        retryAfter: Math.ceil((timestamps[0] + windowMs - now) / 1000)
      }, 429);
    }

    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
    await next();
  };
}

// ── JWT Secret ──
const getAdminJwtSecret = (c) => c.env.ADMIN_JWT_SECRET || 'midnight_stories_admin_secret_2026';

// ── Admin Auth Middleware ──
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

// ── Permission Checking Helpers ──
const requirePermission = (resource, action) => {
  return async (c, next) => {
    const admin = c.get('admin');
    if (!admin) return c.json({ error: 'Unauthorized' }, 401);
    
    // Super admins bypass all checks
    if (admin.role === 'super_admin') {
      await next();
      return;
    }
    
    const db = c.env.DB;
    const permission = await db.prepare(`
      SELECT 1 FROM role_permissions rp
      JOIN roles r ON rp.role_id = r.id
      JOIN user_roles ur ON r.id = ur.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.admin_user_id = ? 
        AND ur.account_id = (
          SELECT account_id FROM admin_users WHERE id = ?
        )
        AND p.resource = ? AND p.action = ?
    `).bind(admin.adminId, admin.adminId, resource, action).first();
    
    if (!permission) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    
    await next();
  };
};

// ── Account Scoping Helper ──
const getAccountIdFromContext = async (c) => {
  const admin = c.get('admin');
  if (!admin) return null;
  const db = c.env.DB;
  const result = await db.prepare('SELECT account_id FROM admin_users WHERE id = ?').bind(admin.adminId).first();
  return result ? result.account_id : null;
};

// ── Employee Auth Middleware ──
const requireEmployee = async (c, next) => {
  const token = c.req.header('x-employee-token');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const payload = await verifyJWT(token, getAdminJwtSecret(c));
    if (!payload.employeeId) return c.json({ error: 'Invalid token type' }, 401);
    c.set('employee', payload);
    await next();
  } catch {
    return c.json({ error: 'Unauthorized. Session expired or invalid.' }, 401);
  }
};

// ═════════════════════════════════════════════════════════
// ██  MAIN APP
// ═════════════════════════════════════════════════════════
const app = new Hono();

// ── CORS for admin subdomain ──
app.use('*', cors({
  origin: [
    'https://admin.midnightstories.dpdns.org',
    'https://midnightstories.dpdns.org',
    'http://localhost:3000',
    'http://localhost:8787'
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Admin-Token', 'Authorization'],
  credentials: true
}));

// ── Health Check ──
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', service: 'admin', timestamp: new Date().toISOString() });
});

// ═════════════════════════════════════════════════════════
// ██  ADMIN AUTH API
// ═════════════════════════════════════════════════════════
app.post('/api/admin/login', rateLimit('admin-login', 10), async (c) => {
  const db = c.env.DB;
  const { username, password } = await c.req.json();

  const admin = await db.prepare('SELECT * FROM admin_users WHERE username = ?').bind(username).first();
  const passwordMatch = admin ? await bcrypt.compare(password, admin.password_hash) : false;
  if (!admin || !passwordMatch) return c.json({ error: 'Invalid credentials.' }, 401);

  if (admin.mfa_enabled) {
    const preToken = await signJWT({ adminId: admin.id, username: admin.username, step: 'mfa', exp: Math.floor(Date.now() / 1000) + 300 }, getAdminJwtSecret(c));
    return c.json({ requireMFA: true, preToken });
  }

  const token = await signJWT({ adminId: admin.id, username: admin.username, role: admin.role, exp: Math.floor(Date.now() / 1000) + 28800 }, getAdminJwtSecret(c));
  return c.json({ token, username: admin.username, role: admin.role, mfaEnabled: false });
});

app.post('/api/admin/mfa-verify', async (c) => {
  const db = c.env.DB;
  const { preToken, code } = await c.req.json();

  let payload;
  try {
    payload = await verifyJWT(preToken, getAdminJwtSecret(c));
  } catch (err) {
    return c.json({ error: 'Invalid or expired pre-auth token.' }, 401);
  }

  if (payload.step !== 'mfa') {
    return c.json({ error: 'Invalid pre-auth token.' }, 401);
  }

  const admin = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(payload.adminId).first();
  const isValid = authenticator.verify({ token: code, secret: admin.mfa_secret });

  if (!isValid) {
    return c.json({ error: 'Invalid MFA code.' }, 401);
  }

  const token = await signJWT({ adminId: admin.id, username: admin.username, role: admin.role, exp: Math.floor(Date.now() / 1000) + 28800 }, getAdminJwtSecret(c));
  return c.json({ token, username: admin.username, role: admin.role });
});

app.post('/api/admin/mfa-setup', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const admin = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(adminPayload.adminId).first();
  const secret = admin.mfa_secret || authenticator.generateSecret();

  if (!admin.mfa_secret) {
    await db.prepare('UPDATE admin_users SET mfa_secret = ? WHERE id = ?').run(secret, admin.id);
  }

  const otpauth = authenticator.keyuri(admin.email, 'Midnight Stories Admin', secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  return c.json({ secret, qrCode: qrDataUrl, email: admin.email });
});

app.post('/api/admin/mfa-enable', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { code } = await c.req.json();
  const admin = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(adminPayload.adminId).first();

  const isValid = authenticator.verify({ token: code, secret: admin.mfa_secret });
  if (!isValid) {
    return c.json({ error: 'Invalid code. Please try again.' }, 400);
  }

  await db.prepare('UPDATE admin_users SET mfa_enabled = 1 WHERE id = ?').run(admin.id);
  return c.json({ message: 'MFA enabled successfully.' });
});

// ═════════════════════════════════════════════════════════
// ██  ADMIN DASHBOARD STATS
// ═════════════════════════════════════════════════════════
app.get('/api/admin/stats', requireAdmin, async (c) => {
  const db = c.env.DB;

  const totalStories = (await db.prepare('SELECT COUNT(*) as c FROM stories').first()).c;
  const pendingStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'pending'").first()).c;
  const approvedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'approved'").first()).c;
  const rejectedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'rejected'").first()).c;
  const totalComments = (await db.prepare('SELECT COUNT(*) as c FROM comments').first()).c;
  const pendingComments = (await db.prepare("SELECT COUNT(*) as c FROM comments WHERE status = 'pending'").first()).c;
  const totalUsers = (await db.prepare('SELECT COUNT(*) as c FROM users').first()).c;
  const totalLikes = (await db.prepare('SELECT COALESCE(SUM(like_count), 0) as c FROM stories').first()).c;
  const openReports = (await db.prepare("SELECT COUNT(*) as c FROM reports WHERE ticket_status != 'resolved' AND ticket_status != 'closed'").first()).c;
  const bannedIPs = (await db.prepare('SELECT COUNT(*) as c FROM banned_identifiers').first()).c;

  // Book stats
  const totalBooks = (await db.prepare('SELECT COUNT(*) as c FROM books').first()).c;
  const pendingBooks = (await db.prepare("SELECT COUNT(*) as c FROM books WHERE is_user_submission = 1 AND submission_status = 'pending'").first()).c;
  const totalCategories = (await db.prepare('SELECT COUNT(*) as c FROM categories').first()).c;

  const dailyStories = await db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM stories
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all();

  return c.json({
    totalStories, pendingStories, approvedStories, rejectedStories,
    totalComments, pendingComments, totalUsers, totalLikes,
    openReports, bannedIPs, 
    totalBooks, pendingBooks, totalCategories,
    dailyStories: dailyStories.results || []
  });
});

// ═════════════════════════════════════════════════════════
// ██  MODERATION QUEUES
// ═════════════════════════════════════════════════════════
app.get('/api/admin/queue', requireAdmin, async (c) => {
  const db = c.env.DB;
  const type = c.req.query('type') || 'stories';
  const status = c.req.query('status') || 'pending';

  if (type === 'stories') {
    const { results } = await db.prepare(`
      SELECT s.id, s.user_id, s.title, s.content AS body, s.category_id, s.image_url, s.status, s.submitter_token, s.ip_hash, s.like_count, s.comment_count, s.created_at, s.updated_at, c.name as category_name, u.full_name as author_name
      FROM stories s
      LEFT JOIN categories c ON s.category_id = c.id
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.status = ?
      ORDER BY s.created_at ASC
    `).bind(status).all();
    return c.json({ items: results, type: 'stories' });
  } else {
    const { results } = await db.prepare(`
      SELECT cm.id, cm.story_id, cm.user_id, cm.content AS body, cm.status, cm.ip_hash, cm.created_at, s.title as story_title, u.full_name as author_name
      FROM comments cm
      LEFT JOIN stories s ON cm.story_id = s.id
      LEFT JOIN users u ON cm.user_id = u.id
      WHERE cm.status = ?
      ORDER BY cm.created_at ASC
    `).bind(status).all();
    return c.json({ items: results, type: 'comments' });
  }
});

app.post('/api/admin/moderate', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { target_type, target_id, action, reason } = await c.req.json();

  if (!['approve', 'reject', 'remove'].includes(action)) {
    return c.json({ error: 'Invalid action.' }, 400);
  }

  const statusMap = { approve: 'approved', reject: 'rejected', remove: 'removed' };
  const table = target_type === 'story' ? 'stories' : 'comments';
  const targetIdInt = parseInt(target_id);

  await db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).bind(statusMap[action], targetIdInt).run();

  // Update comment count if moderating a comment
  if (target_type === 'comment') {
    const comment = await db.prepare('SELECT story_id FROM comments WHERE id = ?').bind(targetIdInt).first();
    if (comment) {
      const count = (await db.prepare("SELECT COUNT(*) as c FROM comments WHERE story_id = ? AND status = 'approved'").bind(comment.story_id).first()).c;
      await db.prepare('UPDATE stories SET comment_count = ? WHERE id = ?').bind(count, comment.story_id).run();
    }
  }

  await db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind(target_type, targetIdInt, adminPayload.adminId, action, reason || null).run();

  return c.json({ message: `Content ${statusMap[action]} successfully.` });
});

// ═════════════════════════════════════════════════════════
// ██  REPORTS MANAGEMENT
// ═════════════════════════════════════════════════════════
app.get('/api/admin/reports', requireAdmin, async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status') || 'open';

  try {
    const { results } = await db.prepare(`
      SELECT r.*,
             CASE WHEN r.reported_item_type = 'story' THEN (SELECT title FROM stories WHERE id = r.reported_item_id)
                  WHEN r.reported_item_type = 'comment' THEN (SELECT content FROM comments WHERE id = r.reported_item_id)
                  ELSE NULL END as target_preview,
             CASE WHEN r.reported_item_type = 'story' THEN (SELECT user_id FROM stories WHERE id = r.reported_item_id)
                  WHEN r.reported_item_type = 'comment' THEN (SELECT user_id FROM comments WHERE id = r.reported_item_id)
                  ELSE r.reported_item_id END as target_user_id,
             u.full_name as reporter_name, u.created_at as reporter_join_date
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      WHERE r.ticket_status = ? OR (r.ticket_status != 'closed' AND r.ticket_status != 'resolved' AND ? = 'open')
      ORDER BY r.created_at DESC
    `).bind(status, status).all();
    return c.json(results);
  } catch (err) {
    console.error('GET /api/admin/reports ERROR:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

app.post('/api/admin/reports/:id/resolve', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const reportId = parseInt(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  await db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?').bind(reportId).run();

  await db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind('report', reportId, adminPayload.adminId, 'resolve_report', body.reason || null).run();

  return c.json({ message: 'Report resolved.' });
});

// ═════════════════════════════════════════════════════════
// ██  CATEGORIES MANAGEMENT
// ═════════════════════════════════════════════════════════
app.get('/api/admin/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM stories WHERE category_id = c.id) as story_count
    FROM categories c ORDER BY c.name
  `).all();
  return c.json(results);
});

app.post('/api/admin/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { name } = await c.req.json();
  if (!name) return c.json({ error: 'Name is required.' }, 400);

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try {
    await db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name, slug);
    return c.json({ message: 'Category created.' });
  } catch (e) {
    return c.json({ error: 'Category already exists.' }, 400);
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('UPDATE stories SET category_id = NULL WHERE category_id = ?').bind(id).run();
  await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return c.json({ message: 'Category deleted.' });
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

// ═════════════════════════════════════════════════════════
// ██  BANS MANAGEMENT
// ═════════════════════════════════════════════════════════
app.post('/api/admin/ban', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { identifier, reason, duration_hours } = await c.req.json();

  const expiresAt = duration_hours
    ? new Date(Date.now() + parseInt(duration_hours) * 60 * 60 * 1000).toISOString()
    : null;

  await db.prepare(
    'INSERT INTO banned_identifiers (identifier, type, reason, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(identifier, 'ip', reason || 'Policy violation', expiresAt).run();

  await db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind('ban', 0, adminPayload.adminId, 'ban_ip', `Banned: ${identifier} - ${reason || 'Policy violation'}`).run();

  return c.json({ message: 'IP banned successfully.' });
});

app.get('/api/admin/bans', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM banned_identifiers ORDER BY created_at DESC').all();
  return c.json(results);
});

app.delete('/api/admin/bans/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM banned_identifiers WHERE id = ?').bind(id).run();
  return c.json({ message: 'Ban removed.' });
});

// ═════════════════════════════════════════════════════════
// ██  AUDIT LOG
// ═════════════════════════════════════════════════════════
app.get('/api/admin/audit-log', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT ml.*, au.username as admin_username
    FROM moderation_log ml
    LEFT JOIN admin_users au ON ml.admin_id = au.id
    ORDER BY ml.created_at DESC
    LIMIT 100
  `).all();
  return c.json(results);
});

// ═════════════════════════════════════════════════════════
// ██  SETTINGS MANAGEMENT
// ═════════════════════════════════════════════════════════
app.get('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM settings').all();
  const result = {};
  for (const s of results) {
    try { result[s.key] = JSON.parse(s.value); } catch { result[s.key] = s.value; }
  }
  return c.json(result);
});

app.put('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const updates = await c.req.json();

  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
  for (const [key, value] of Object.entries(updates)) {
    const val = typeof value === 'object' ? JSON.stringify(value) : String(value);
    await upsert.run(key, val, val);
  }

  await db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind('settings', 0, adminPayload.adminId, 'update_settings', `Updated keys: ${Object.keys(updates).join(', ')}`).run();

  return c.json({ message: 'Settings updated.' });
});

// ═════════════════════════════════════════════════════════
// ██  USER MANAGEMENT (Admin)
// ═════════════════════════════════════════════════════════
app.get('/api/admin/users', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT id, user_id, full_name, email, created_at FROM users ORDER BY created_at DESC').all();
  return c.json(results);
});

app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ message: 'User deleted successfully.' });
});

app.get('/api/admin/stories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT s.*, c.name as category_name, u.full_name as author_name
    FROM stories s
    LEFT JOIN categories c ON s.category_id = c.id
    LEFT JOIN users u ON s.user_id = u.id
    ORDER BY s.created_at DESC
    LIMIT 100
  `).all();
  return c.json(results);
});

app.delete('/api/admin/stories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM stories WHERE id = ?').bind(id).run();
  return c.json({ message: 'Story deleted.' });
});

// ═════════════════════════════════════════════════════════
// ██  SERVE ADMIN FRONTEND
// ═════════════════════════════════════════════════════════

// Serve static assets from public/
app.get('/css/*', async (c) => {
  const path = c.req.path;
  const asset = await c.env.ADMIN_ASSETS ? c.env.ADMIN_ASSETS.get(path.slice(1)) : null;
  if (!asset) return c.text('Not found', 404);
  const headers = new Headers();
  asset.writeHttpMetadata(headers);
  headers.set('etag', asset.httpEtag);
  if (path.endsWith('.css')) headers.set('Content-Type', 'text/css');
  return new Response(asset.body, { headers });
});

app.get('/js/*', async (c) => {
  const path = c.req.path;
  const asset = await c.env.ADMIN_ASSETS ? c.env.ADMIN_ASSETS.get(path.slice(1)) : null;
  if (!asset) return c.text('Not found', 404);
  const headers = new Headers();
  asset.writeHttpMetadata(headers);
  headers.set('etag', asset.httpEtag);
  if (path.endsWith('.js')) headers.set('Content-Type', 'application/javascript');
  return new Response(asset.body, { headers });
});

app.get('/favicon.svg', async (c) => {
  const asset = await c.env.ADMIN_ASSETS ? c.env.ADMIN_ASSETS.get('favicon.svg') : null;
  if (!asset) return c.text('Not found', 404);
  const headers = new Headers();
  asset.writeHttpMetadata(headers);
  headers.set('etag', asset.httpEtag);
  headers.set('Content-Type', 'image/svg+xml');
  return new Response(asset.body, { headers });
});

// Serve index.html for all other routes (SPA)
app.get('*', async (c) => {
  const asset = await c.env.ADMIN_ASSETS ? c.env.ADMIN_ASSETS.get('index.html') : null;
  if (!asset) return c.text('Admin panel not configured', 500);
  const headers = new Headers();
  asset.writeHttpMetadata(headers);
  headers.set('etag', asset.httpEtag);
  headers.set('Content-Type', 'text/html');
  return new Response(asset.body, { headers });
});


// ---------------------------------------------------------
// ██  ADVANCED MODERATION & AUDITING API
// ---------------------------------------------------------

app.get('/api/admin/users/:id/audit', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = parseInt(c.req.param('id'));

  const user = await db.prepare('SELECT id, user_id, full_name, email, phone_number, account_status, dm_permission, visit_count, interaction_permissions, created_at FROM users WHERE id = ?').bind(userId).first();
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
  await db.prepare('UPDATE users SET interaction_permissions = ? WHERE id = ?').bind(JSON.stringify(permissions), userId).run();
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
  
  await db.prepare('INSERT INTO ticket_conversation_threads (report_id, sender_id, sender_role, message_body) VALUES (?, ?, ?, ?)').bind(reportId, adminPayload.adminId, 'admin', reply).run();
  await db.prepare('UPDATE reports SET ticket_status = "resolved", resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?').bind(adminPayload.adminId, reportId).run();
  return c.json({ message: 'Reply sent and report resolved.' });
});

app.post('/api/admin/messages/send', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { user_id, title, body } = await c.req.json();
  const adminPayload = c.get('admin');
  
  await db.prepare('INSERT INTO admin_messages (user_id, admin_id, title, body) VALUES (?, ?, ?, ?)').bind(parseInt(user_id), adminPayload.adminId, title, body).run();
  return c.json({ message: 'Message sent successfully.' });
});

// ═════════════════════════════════════════════════════════
// ██  TICKET TAXONOMY API
// ═════════════════════════════════════════════════════════
app.get('/api/admin/tax/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM ticket_categories ORDER BY name').all();
  return c.json(results);
});

app.post('/api/admin/tax/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { name, description } = await c.req.json();
  if (!name) return c.json({ error: 'Name is required.' }, 400);
  try {
    const r = await db.prepare('INSERT INTO ticket_categories (name, description) VALUES (?, ?)').bind(name, description || null).run();
    return c.json({ id: r.meta.last_row_id, message: 'Category created.' }, 201);
  } catch (e) {
    return c.json({ error: 'Category already exists.' }, 400);
  }
});

app.delete('/api/admin/tax/categories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const active = await db.prepare("SELECT COUNT(*) as c FROM ticket_subcategories WHERE category_id = ?").bind(id).first();
  if (active.c > 0) return c.json({ error: 'Archive or delete sub-categories first.' }, 400);
  await db.prepare('DELETE FROM ticket_categories WHERE id = ?').bind(id).run();
  return c.json({ message: 'Category deleted.' });
});

app.get('/api/admin/tax/subcategories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT s.*, c.name as category_name FROM ticket_subcategories s
    LEFT JOIN ticket_categories c ON s.category_id = c.id ORDER BY c.name, s.name
  `).all();
  return c.json(results);
});

app.post('/api/admin/tax/subcategories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { category_id, name, description } = await c.req.json();
  if (!category_id || !name) return c.json({ error: 'category_id and name are required.' }, 400);
  const r = await db.prepare('INSERT INTO ticket_subcategories (category_id, name, description) VALUES (?, ?, ?)').bind(category_id, name, description || null).run();
  return c.json({ id: r.meta.last_row_id, message: 'Sub-category created.' }, 201);
});

app.delete('/api/admin/tax/subcategories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM ticket_subcategories WHERE id = ?').bind(id).run();
  return c.json({ message: 'Sub-category deleted.' });
});

// ═════════════════════════════════════════════════════════
// ██  ROLES API
// ═════════════════════════════════════════════════════════
app.get('/api/admin/roles', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM roles ORDER BY name').all();
  return c.json(results);
});

app.post('/api/admin/roles', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { name, description } = await c.req.json();
  if (!name) return c.json({ error: 'Name is required.' }, 400);
  try {
    const r = await db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)').bind(name, description || null).run();
    return c.json({ id: r.meta.last_row_id, message: 'Role created.' }, 201);
  } catch (e) {
    return c.json({ error: 'Role already exists.' }, 400);
  }
});

app.delete('/api/admin/roles/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const role = await db.prepare('SELECT is_system FROM roles WHERE id = ?').bind(id).first();
  if (!role) return c.json({ error: 'Role not found.' }, 404);
  if (role.is_system) return c.json({ error: 'Cannot delete system roles.' }, 400);
  const inUse = await db.prepare('SELECT COUNT(*) as c FROM user_roles WHERE role_id = ?').bind(id).first();
  if (inUse.c > 0) return c.json({ error: 'Role is assigned to users. Reassign first.' }, 400);
  await db.prepare('DELETE FROM roles WHERE id = ?').bind(id).run();
  return c.json({ message: 'Role deleted.' });
});

// ═════════════════════════════════════════════════════════
// ██  TEAMS API
// ═════════════════════════════════════════════════════════
app.get('/api/admin/teams', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM teams ORDER BY name').all();
  return c.json(results);
});

app.post('/api/admin/teams', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { name, description } = await c.req.json();
  if (!name) return c.json({ error: 'Name is required.' }, 400);
  try {
    const r = await db.prepare('INSERT INTO teams (name, description) VALUES (?, ?)').bind(name, description || null).run();
    return c.json({ id: r.meta.last_row_id, message: 'Team created.' }, 201);
  } catch (e) {
    return c.json({ error: 'Team already exists.' }, 400);
  }
});

app.delete('/api/admin/teams/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const members = await db.prepare('SELECT COUNT(*) as c FROM team_members WHERE team_id = ?').bind(id).first();
  if (members.c > 0) return c.json({ error: 'Remove all team members first.' }, 400);
  await db.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
  return c.json({ message: 'Team deleted.' });
});

// ═════════════════════════════════════════════════════════
// ██  EMPLOYEE PROVISIONING API
// ═════════════════════════════════════════════════════════
app.get('/api/admin/employees/invites', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT i.*, t.name as team_name FROM employee_invites i
    LEFT JOIN teams t ON i.team_id = t.id
    ORDER BY i.invited_at DESC
  `).all();
  return c.json(results);
});

app.post('/api/admin/employees/invite', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { email, full_name, team_id, role_id, account_id } = await c.req.json();
  if (!email || !full_name || !account_id) return c.json({ error: 'email, full_name, and account_id are required.' }, 400);
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const r = await db.prepare(
      'INSERT INTO employee_users (email, full_name, account_id, team_id, role_id, invite_token, invite_expires, employment_status) VALUES (?, ?, ?, ?, ?, ?, ?, \'pending_invite\')'
    ).bind(email, full_name, account_id, team_id || null, role_id || null, token, expires).run();
    await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'employee.invite', targetType: 'employee', targetId: r.meta.last_row_id, newValue: { email, full_name, account_id } });
    return c.json({ message: 'Invite created.', token, id: r.meta.last_row_id }, 201);
  } catch {
    return c.json({ error: 'Employee with this email already exists.' }, 400);
  }
});

// ═════════════════════════════════════════════════════════
// ██  EMPLOYEE USERS CRUD
// ═════════════════════════════════════════════════════════
app.get('/api/admin/employees', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT eu.id, eu.full_name, eu.email, eu.phone, eu.employment_status,
           eu.last_login_at, eu.created_at, eu.account_id, eu.team_id, eu.role_id,
           t.name as team_name, r.name as role_name, a.name as account_name
    FROM employee_users eu
    LEFT JOIN teams t ON eu.team_id = t.id
    LEFT JOIN roles r ON eu.role_id = r.id
    LEFT JOIN accounts a ON eu.account_id = a.id
    ORDER BY eu.created_at DESC
  `).all();
  return c.json(results);
});

app.get('/api/admin/employees/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const emp = await db.prepare(`
    SELECT eu.*, t.name as team_name, r.name as role_name, a.name as account_name
    FROM employee_users eu
    LEFT JOIN teams t ON eu.team_id = t.id
    LEFT JOIN roles r ON eu.role_id = r.id
    LEFT JOIN accounts a ON eu.account_id = a.id
    WHERE eu.id = ?
  `).bind(id).first();
  if (!emp) return c.json({ error: 'Employee not found.' }, 404);
  const perms = await getEffectivePermissions(db, id);
  return c.json({ ...emp, effectivePermissions: perms });
});

app.put('/api/admin/employees/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const { full_name, team_id, role_id, employment_status, phone } = await c.req.json();
  const old = await db.prepare('SELECT * FROM employee_users WHERE id = ?').bind(id).first();
  if (!old) return c.json({ error: 'Employee not found.' }, 404);
  await db.prepare(
    'UPDATE employee_users SET full_name=?, team_id=?, role_id=?, employment_status=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(full_name ?? old.full_name, team_id ?? old.team_id, role_id ?? old.role_id, employment_status ?? old.employment_status, phone ?? old.phone, id).run();
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'employee.update', targetType: 'employee', targetId: id, oldValue: old, newValue: { full_name, team_id, role_id, employment_status } });
  return c.json({ message: 'Employee updated.' });
});

app.delete('/api/admin/employees/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const emp = await db.prepare('SELECT id, email FROM employee_users WHERE id = ?').bind(id).first();
  if (!emp) return c.json({ error: 'Employee not found.' }, 404);
  await db.prepare('DELETE FROM employee_users WHERE id = ?').bind(id).run();
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'employee.delete', targetType: 'employee', targetId: id, oldValue: { email: emp.email } });
  return c.json({ message: 'Employee deleted.' });
});

// ── Employee: accept invite & set password ──
app.post('/api/employee/accept-invite', async (c) => {
  const db = c.env.DB;
  const { token, password } = await c.req.json();
  if (!token || !password) return c.json({ error: 'token and password are required.' }, 400);
  const emp = await db.prepare(
    "SELECT * FROM employee_users WHERE invite_token = ? AND employment_status = 'pending_invite'"
  ).bind(token).first();
  if (!emp) return c.json({ error: 'Invalid or expired invite.' }, 400);
  if (emp.invite_expires && new Date(emp.invite_expires) < new Date()) return c.json({ error: 'Invite has expired.' }, 400);
  const hash = await bcrypt.hash(password, 10);
  await db.prepare(
    "UPDATE employee_users SET password_hash=?, invite_token=NULL, invite_expires=NULL, employment_status='active', updated_at=CURRENT_TIMESTAMP WHERE id=?"
  ).bind(hash, emp.id).run();
  return c.json({ message: 'Account activated. You can now log in.' });
});

// ── Employee: login ──
app.post('/api/employee/login', rateLimit('employee-login', 10), async (c) => {
  const db = c.env.DB;
  const { email, password } = await c.req.json();
  const emp = await db.prepare("SELECT * FROM employee_users WHERE email = ? AND employment_status = 'active'").bind(email).first();
  const ok = emp ? await bcrypt.compare(password, emp.password_hash || '') : false;
  if (!ok) return c.json({ error: 'Invalid credentials.' }, 401);
  await db.prepare('UPDATE employee_users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?').bind(emp.id).run();
  const token = await signJWT({ employeeId: emp.id, email: emp.email, accountId: emp.account_id, roleId: emp.role_id, exp: Math.floor(Date.now() / 1000) + 28800 }, getAdminJwtSecret(c));
  return c.json({ token, employeeId: emp.id, email: emp.email });
});

// ── Employee: get own effective permissions ──
app.get('/api/employee/me/permissions', requireEmployee, async (c) => {
  const emp = c.get('employee');
  const perms = await getEffectivePermissions(c.env.DB, emp.employeeId);
  return c.json(perms);
});

// ═════════════════════════════════════════════════════════
// ██  PERMISSION OVERRIDES API
// ═════════════════════════════════════════════════════════
app.get('/api/admin/employees/:id/overrides', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { results } = await db.prepare(`
    SELECT epo.*, p.code, p.description, p.module
    FROM employee_permission_overrides epo
    JOIN permissions p ON p.id = epo.permission_id
    WHERE epo.employee_id = ?
    ORDER BY p.module, p.code
  `).bind(id).all();
  return c.json(results);
});

app.post('/api/admin/employees/:id/overrides', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const employeeId = parseInt(c.req.param('id'));
  const { permission_id, effect, reason, expires_at } = await c.req.json();
  if (!permission_id || !effect || !reason) return c.json({ error: 'permission_id, effect, and reason are required.' }, 400);
  if (!['allow', 'deny'].includes(effect)) return c.json({ error: 'effect must be allow or deny.' }, 400);
  try {
    await db.prepare(
      'INSERT INTO employee_permission_overrides (employee_id, permission_id, effect, reason, granted_by, expires_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(employee_id, permission_id) DO UPDATE SET effect=excluded.effect, reason=excluded.reason, granted_by=excluded.granted_by, expires_at=excluded.expires_at'
    ).bind(employeeId, permission_id, effect, reason, adminPayload.adminId, expires_at || null).run();
    await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'permission.override', targetType: 'employee', targetId: employeeId, newValue: { permission_id, effect, reason } });
    return c.json({ message: 'Override saved.' });
  } catch (e) {
    return c.json({ error: 'Failed to save override.' }, 500);
  }
});

app.delete('/api/admin/employees/:id/overrides/:permId', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const employeeId = parseInt(c.req.param('id'));
  const permId = parseInt(c.req.param('permId'));
  await db.prepare('DELETE FROM employee_permission_overrides WHERE employee_id=? AND permission_id=?').bind(employeeId, permId).run();
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'permission.override.remove', targetType: 'employee', targetId: employeeId, oldValue: { permission_id: permId } });
  return c.json({ message: 'Override removed.' });
});

// ── Get effective permissions for any employee ──
app.get('/api/admin/employees/:id/effective-permissions', requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'));
  const perms = await getEffectivePermissions(c.env.DB, id);
  return c.json(perms);
});

// ═════════════════════════════════════════════════════════
// ██  ACCOUNTS API
// ═════════════════════════════════════════════════════════
app.get('/api/admin/accounts', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM employee_users WHERE account_id = a.id) as employee_count,
      (SELECT COUNT(*) FROM teams WHERE account_id = a.id) as team_count
    FROM accounts a ORDER BY a.name
  `).all();
  return c.json(results);
});

app.post('/api/admin/accounts', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { name, domain } = await c.req.json();
  if (!name) return c.json({ error: 'name is required.' }, 400);
  try {
    const r = await db.prepare('INSERT INTO accounts (name, domain) VALUES (?, ?)').bind(name, domain || null).run();
    await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'account.create', targetType: 'account', targetId: r.meta.last_row_id, newValue: { name } });
    return c.json({ id: r.meta.last_row_id, message: 'Account created.' }, 201);
  } catch {
    return c.json({ error: 'Account name or domain already exists.' }, 400);
  }
});

app.get('/api/admin/accounts/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const account = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  if (!account) return c.json({ error: 'Account not found.' }, 404);
  const { results: teams } = await db.prepare('SELECT id, name, status FROM teams WHERE account_id = ?').bind(id).all();
  const { results: employees } = await db.prepare('SELECT id, full_name, email, employment_status, role_id FROM employee_users WHERE account_id = ?').bind(id).all();
  return c.json({ ...account, teams, employees });
});

app.put('/api/admin/accounts/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const { name, domain, status } = await c.req.json();
  const old = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  if (!old) return c.json({ error: 'Account not found.' }, 404);
  await db.prepare(
    'UPDATE accounts SET name=?, domain=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(name ?? old.name, domain ?? old.domain, status ?? old.status, id).run();
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'account.update', targetType: 'account', targetId: id, oldValue: old, newValue: { name, domain, status } });
  return c.json({ message: 'Account updated.' });
});

app.delete('/api/admin/accounts/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const empCount = (await db.prepare('SELECT COUNT(*) as c FROM employee_users WHERE account_id = ?').bind(id).first()).c;
  if (empCount > 0) return c.json({ error: 'Remove all employees from this account first.' }, 400);
  await db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'account.delete', targetType: 'account', targetId: id });
  return c.json({ message: 'Account deleted.' });
});

// ═════════════════════════════════════════════════════════
// ██  PERMISSIONS LIST & ROLES MANAGEMENT
// ═════════════════════════════════════════════════════════
app.get('/api/admin/permissions', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM permissions ORDER BY module, code').all();
  return c.json(results);
});

app.get('/api/admin/roles/:id/permissions', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { results } = await db.prepare(`
    SELECT rp.permission_id, rp.effect, p.code, p.module, p.description
    FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ?
  `).bind(id).all();
  return c.json(results);
});

app.put('/api/admin/roles/:id/permissions', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const roleId = parseInt(c.req.param('id'));
  // Body: [{ permission_id, effect }]
  const perms = await c.req.json();
  if (!Array.isArray(perms)) return c.json({ error: 'Expected array of { permission_id, effect }.' }, 400);
  const role = await db.prepare('SELECT is_system FROM roles WHERE id = ?').bind(roleId).first();
  if (!role) return c.json({ error: 'Role not found.' }, 404);
  // Replace all permissions for this role
  const stmts = [db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleId)];
  for (const { permission_id, effect } of perms) {
    if (!['allow', 'deny'].includes(effect)) continue;
    stmts.push(db.prepare('INSERT INTO role_permissions (role_id, permission_id, effect) VALUES (?, ?, ?)').bind(roleId, permission_id, effect));
  }
  await db.batch(stmts);
  await writeAuditLog(db, { actorId: adminPayload.adminId, actorType: 'admin', action: 'role.permissions.update', targetType: 'role', targetId: roleId, newValue: perms });
  return c.json({ message: 'Role permissions updated.' });
});

// ═════════════════════════════════════════════════════════
// ██  AUDIT LOG (RBAC)
// ═════════════════════════════════════════════════════════
app.get('/api/admin/rbac/audit-log', requireAdmin, async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);
  const offset = parseInt(c.req.query('offset') || '0');
  const actorType = c.req.query('actor_type');
  const action = c.req.query('action');

  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const binds = [];
  if (actorType) { query += ' AND actor_type = ?'; binds.push(actorType); }
  if (action)    { query += ' AND action LIKE ?';   binds.push(`%${action}%`); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const { results } = await db.prepare(query).bind(...binds).all();
  return c.json(results);
});

export default app;
