// admin/src/worker.js — Dedicated Admin Worker for Midnight Stories
// Deploys to: https://admin.midnightstories.dpdns.org/
// Connects to the same D1 database as the main public site.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';

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
  const totalLikes = (await db.prepare('SELECT COALESCE(SUM(likes_count), 0) as c FROM stories').first()).c;
  const openReports = (await db.prepare('SELECT COUNT(*) as c FROM reports WHERE resolved = 0').first()).c;
  const bannedIPs = (await db.prepare('SELECT COUNT(*) as c FROM banned_identifiers').first()).c;

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
    openReports, bannedIPs, dailyStories: dailyStories.results || []
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
      SELECT s.*, c.name as category_name, u.full_name as author_name
      FROM stories s
      LEFT JOIN categories c ON s.category_id = c.id
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.status = ?
      ORDER BY s.created_at ASC
    `).bind(status).all();
    return c.json({ items: results, type: 'stories' });
  } else {
    const { results } = await db.prepare(`
      SELECT cm.*, s.title as story_title, u.full_name as author_name
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
  const resolved = c.req.query('resolved') || '0';

  const { results } = await db.prepare(`
    SELECT r.*, 
      CASE r.target_type 
        WHEN 'story' THEN (SELECT title FROM stories WHERE id = r.target_id)
        WHEN 'comment' THEN (SELECT substr(body, 1, 100) FROM comments WHERE id = r.target_id)
      END as target_preview
    FROM reports r
    WHERE r.resolved = ?
    ORDER BY r.created_at DESC
  `).bind(parseInt(resolved)).all();

  return c.json(results);
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
// ��  ADVANCED MODERATION & AUDITING API
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
  const { results } = await db.prepare(`SELECT target_type, target_id, COUNT(*) as incident_count, MAX(created_at) as last_reported_at
    FROM reports
    WHERE resolved = 0
    GROUP BY target_type, target_id
    ORDER BY incident_count DESC`).all();
  return c.json(results);
});

app.get('/api/admin/reports/target', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { target_type, target_id } = c.req.query();
  const { results } = await db.prepare('SELECT r.*, u.full_name as reporter_name FROM reports r LEFT JOIN users u ON r.reporter_id = u.id WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC').bind(target_type, parseInt(target_id)).all();
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
  const { user_id, title, body } = await c.req.json();
  const adminPayload = c.get('admin');
  
  await db.prepare('INSERT INTO admin_messages (user_id, admin_id, title, body) VALUES (?, ?, ?, ?)').bind(parseInt(user_id), adminPayload.adminId, title, body).run();
  return c.json({ message: 'Message sent successfully.' });
});

app.get('/api/users/me/support-inbox', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  
  const { results: messages } = await db.prepare('SELECT * FROM admin_messages WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
  const { results: reports } = await db.prepare('SELECT * FROM reports WHERE reporter_id = ? AND resolved = 1 AND admin_reply IS NOT NULL ORDER BY resolved_at DESC').bind(user.id).all();
  
  return c.json({ messages, reports });
});

app.post('/api/users/me/messages/:id/read', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const msgId = parseInt(c.req.param('id'));
  await db.prepare('UPDATE admin_messages SET is_read = 1 WHERE id = ? AND user_id = ?').bind(msgId, user.id).run();
  return c.json({ success: true });
});
export default app;



