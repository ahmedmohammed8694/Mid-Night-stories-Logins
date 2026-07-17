// src/worker.js — Cloudflare Worker entry point for Midnight Stories
// Handles all API and image upload routes; static assets are served by Workers Assets

import { Hono } from 'hono';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';

import {
  moderateText, hashIP, detectCrisisLanguage, detectPII, checkImageSafety
} from './moderation.js';

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

const app = new Hono();

// ── In-Memory Rate Limiting (Isolate-level) ──
const rateLimitMap = new Map();

function rateLimit(type, maxPerHour) {
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') || '127.0.0.1';
    const key = `${type}:${ip}`;
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour

    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, []);
    }

    const timestamps = rateLimitMap.get(key).filter(t => now - t < windowMs);
    if (timestamps.length >= maxPerHour) {
      return c.json({
        error: 'Rate limit exceeded',
        message: `You can only make ${maxPerHour} ${type} requests per hour. Please try again later.`,
        retryAfter: Math.ceil((timestamps[0] + windowMs - now) / 1000)
      }, 429);
    }

    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
    await next();
  };
}

// ── JWT Secret helper ──
const getJwtSecret = (c) => c.env.ADMIN_JWT_SECRET || 'midnight_stories_jwt_secret_2026';

// ── Admin Session Middleware (Stateless JWT) ──
const requireAdmin = async (c, next) => {
  const token = c.req.header('x-admin-token');
  if (!token) {
    return c.json({ error: 'Unauthorized. Please log in.' }, 401);
  }
  try {
    const payload = await verifyJWT(token, getJwtSecret(c));
    if (payload.step === 'mfa') {
      return c.json({ error: 'MFA verification required.' }, 401);
    }
    c.set('admin', payload);
    await next();
  } catch (err) {
    return c.json({ error: 'Unauthorized. Session expired or invalid.' }, 401);
  }
};

// ── Ban Check Middleware ──
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
  if (!c.env.IMAGES) {
    return c.text('R2 bucket not configured', 500);
  }
  const object = await c.env.IMAGES.get(filename);
  if (!object) {
    return c.text('Image not found', 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers, status: 200 });
});

// ═════════════════════════════════════════════════════════
// ██  PUBLIC API ROUTES
// ═════════════════════════════════════════════════════════

// ── GET /api/categories ──
app.get('/api/categories', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM categories ORDER BY name').all();
  return c.json(results);
});

// ── GET /api/stats/public — Community-wide stats for the homepage ──
app.get('/api/stats/public', async (c) => {
  const db = c.env.DB;
  const [storyStats, visitorRow, commentRow] = await Promise.all([
    db.prepare(`
      SELECT
        COALESCE(SUM(like_count), 0)    AS total_likes,
        COALESCE(SUM(comment_count), 0) AS total_comments,
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

// ── POST /api/stats/visit — Increment visitor counter (called once per browser) ──
app.post('/api/stats/visit', async (c) => {
  const db = c.env.DB;
  // Upsert: if key doesn't exist yet, insert it; otherwise increment
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES ('total_visitors', '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  `).run();
  return c.json({ ok: true });
});

// ── GET /api/stories ──
app.get('/api/stories', async (c) => {
  const db = c.env.DB;
  const { sort = 'newest', category, search, page = 1, limit = 12 } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = "WHERE s.status = 'approved'";
  const params = [];

  if (category && category !== 'all') {
    where += ' AND c.slug = ?';
    params.push(category);
  }

  if (search) {
    where += ' AND (s.title LIKE ? OR s.body LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  let orderBy;
  switch (sort) {
    case 'liked': orderBy = 's.like_count DESC'; break;
    case 'discussed': orderBy = 's.comment_count DESC'; break;
    default: orderBy = 's.created_at DESC';
  }

  const countSql = `SELECT COUNT(*) as total FROM stories s LEFT JOIN categories c ON s.category_id = c.id ${where}`;
  const countRes = await db.prepare(countSql).bind(...params).first();
  const total = countRes ? countRes.total : 0;

  const sql = `
    SELECT s.*, c.name as category_name, c.slug as category_slug
    FROM stories s
    LEFT JOIN categories c ON s.category_id = c.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const { results } = await db.prepare(sql).bind(...params, parseInt(limit), offset).all();

  return c.json({
    stories: results.map(s => ({
      ...s,
      body_preview: s.body.substring(0, 200) + (s.body.length > 200 ? '...' : '')
    })),
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit))
  });
});

// ── GET /api/stories/:id ──
app.get('/api/stories/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const story = await db.prepare(`
    SELECT s.*, c.name as category_name, c.slug as category_slug
    FROM stories s
    LEFT JOIN categories c ON s.category_id = c.id
    WHERE s.id = ? AND s.status = 'approved'
  `).bind(id).first();

  if (!story) {
    return c.json({ error: 'Story not found' }, 404);
  }

  const { results: comments } = await db.prepare(`
    SELECT * FROM comments 
    WHERE story_id = ? AND status = 'approved' 
    ORDER BY created_at ASC
  `).bind(id).all();

  return c.json({ story, comments });
});

// ── POST /api/stories — Submit a new story ──
app.post('/api/stories', checkBan, rateLimit('story', 5), async (c) => {
  const db = c.env.DB;
  const ipHash = c.get('ipHash');

  const formData = await c.req.formData();
  const title = formData.get('title');
  const body = formData.get('body');
  const categoryIdStr = formData.get('category_id');
  const ageConfirmed = formData.get('age_confirmed');
  const imageFile = formData.get('image');

  if (!body || body.trim().length < 50) {
    return c.json({ error: 'Story must be at least 50 characters long.' }, 400);
  }

  if (!ageConfirmed || ageConfirmed !== 'true') {
    return c.json({ error: 'You must confirm you are 18 or older.' }, 400);
  }

  let bannedKeywords = [];
  try {
    const setting = await db.prepare("SELECT value FROM settings WHERE key = 'banned_keywords'").first();
    if (setting) bannedKeywords = JSON.parse(setting.value);
  } catch (e) { /* ignore */ }

  const modResult = moderateText(body, bannedKeywords);
  const titleModResult = title ? moderateText(title, bannedKeywords) : null;

  if (modResult.autoAction === 'reject' || (titleModResult && titleModResult.autoAction === 'reject')) {
    return c.json({
      error: 'Your submission contains content that violates our community guidelines.',
      flags: [...modResult.flags, ...(titleModResult?.flags || [])]
    }, 400);
  }

  const crisisResult = detectCrisisLanguage(body);

  let imageUrl = null;
  if (imageFile && imageFile instanceof File && imageFile.size > 0) {
    if (imageFile.size > 5 * 1024 * 1024) {
      return c.json({ error: 'File size must be under 5MB.' }, 400);
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(imageFile.type)) {
      return c.json({ error: 'Only JPG, PNG, and WebP images are allowed' }, 400);
    }

    const safetyCheck = checkImageSafety(imageFile);
    if (!safetyCheck.safe) {
      return c.json({ error: 'Uploaded image did not pass safety checks.' }, 400);
    }

    if (c.env.IMAGES) {
      const ext = imageFile.type.split('/')[1] || 'jpg';
      const filename = `${crypto.randomUUID()}.${ext}`;
      const arrayBuffer = await imageFile.arrayBuffer();
      await c.env.IMAGES.put(filename, arrayBuffer, {
        httpMetadata: { contentType: imageFile.type }
      });
      imageUrl = `/uploads/${filename}`;
    }
  }

  const submitterToken = crypto.randomUUID();

  // Auto-approve everything except explicitly toxic content
  // Admin can delete any story at any time from the admin panel
  let status = 'approved';
  if (modResult.autoAction === 'reject') {
    // Toxic content — still reject at submission time
    status = 'pending'; // Let admin review truly toxic content
  }

  const result = await db.prepare(`
    INSERT INTO stories (title, body, category_id, image_url, status, submitter_token, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    title ? title.trim() : null,
    modResult.redactedText,
    categoryIdStr ? parseInt(categoryIdStr) : null,
    imageUrl,
    status,
    submitterToken,
    ipHash
  ).run();

  const storyId = result.meta.last_row_id;

  if (modResult.flags.length > 0) {
    await db.prepare(
      'INSERT INTO moderation_log (target_type, target_id, action, reason) VALUES (?, ?, ?, ?)'
    ).bind('story', storyId, 'auto_flag', modResult.flags.join('; ')).run();
  }

  return c.json({
    id: storyId,
    status,
    submitterToken,
    crisisDetected: crisisResult.isCrisis,
    crisisSeverity: crisisResult.severity,
    message: status === 'pending'
      ? 'Your story has been submitted and is awaiting review by our moderation team.'
      : 'Your story has been published.',
    important: 'Save your submitter token — it is the only way to edit or delete your story later.'
  }, 201);
});

// ── POST /api/stories/:id/comments ──
app.post('/api/stories/:id/comments', checkBan, rateLimit('comment', 15), async (c) => {
  const db = c.env.DB;
  const ipHash = c.get('ipHash');
  const storyId = parseInt(c.req.param('id'));
  const { body } = await c.req.json();

  if (!body || body.trim().length < 5) {
    return c.json({ error: 'Comment must be at least 5 characters.' }, 400);
  }

  const story = await db.prepare("SELECT id FROM stories WHERE id = ? AND status = 'approved'").bind(storyId).first();
  if (!story) {
    return c.json({ error: 'Story not found.' }, 404);
  }

  let bannedKeywords = [];
  try {
    const setting = await db.prepare("SELECT value FROM settings WHERE key = 'banned_keywords'").first();
    if (setting) bannedKeywords = JSON.parse(setting.value);
  } catch (e) { /* ignore */ }

  const modResult = moderateText(body, bannedKeywords);
  if (modResult.autoAction === 'reject') {
    return c.json({ error: 'Your comment contains content that violates our guidelines.' }, 400);
  }

  // Auto-approve comments — admin can delete anytime
  let status = 'approved';
  if (modResult.autoAction === 'reject') {
    status = 'pending'; // Only hold truly toxic comments for review
  }

  const result = await db.prepare(
    'INSERT INTO comments (story_id, body, status, ip_hash) VALUES (?, ?, ?, ?)'
  ).bind(storyId, modResult.redactedText, status, ipHash).run();

  if (status === 'approved') {
    await db.prepare('UPDATE stories SET comment_count = comment_count + 1 WHERE id = ?').bind(storyId).run();
  }

  return c.json({
    id: result.meta.last_row_id,
    status,
    message: status === 'pending'
      ? 'Your comment is awaiting moderation.'
      : 'Comment posted.'
  }, 201);
});

// ── POST /api/stories/:id/like ──
app.post('/api/stories/:id/like', checkBan, rateLimit('like', 60), async (c) => {
  const db = c.env.DB;
  const ipHash = c.get('ipHash');
  const storyId = parseInt(c.req.param('id'));

  const story = await db.prepare("SELECT id FROM stories WHERE id = ? AND status = 'approved'").bind(storyId).first();
  if (!story) {
    return c.json({ error: 'Story not found.' }, 404);
  }

  const existingLike = await db.prepare(
    'SELECT id FROM likes WHERE story_id = ? AND ip_hash = ?'
  ).bind(storyId, ipHash).first();

  if (existingLike) {
    await db.prepare('DELETE FROM likes WHERE id = ?').bind(existingLike.id).run();
    await db.prepare('UPDATE stories SET like_count = MAX(0, like_count - 1) WHERE id = ?').bind(storyId).run();
    const updated = await db.prepare('SELECT like_count FROM stories WHERE id = ?').bind(storyId).first();
    return c.json({ liked: false, like_count: updated.like_count });
  }

  await db.prepare('INSERT INTO likes (story_id, ip_hash) VALUES (?, ?)').bind(storyId, ipHash).run();
  await db.prepare('UPDATE stories SET like_count = like_count + 1 WHERE id = ?').bind(storyId).run();
  const updated = await db.prepare('SELECT like_count FROM stories WHERE id = ?').bind(storyId).first();
  return c.json({ liked: true, like_count: updated.like_count });
});

// ── POST /api/reports ──
app.post('/api/reports', checkBan, rateLimit('report', 10), async (c) => {
  const db = c.env.DB;
  const ipHash = c.get('ipHash');
  const { target_type, target_id, reason } = await c.req.json();

  if (!['story', 'comment'].includes(target_type)) {
    return c.json({ error: 'Invalid target type.' }, 400);
  }
  if (!target_id || !reason) {
    return c.json({ error: 'Target ID and reason are required.' }, 400);
  }

  const targetIdInt = parseInt(target_id);

  await db.prepare(
    'INSERT INTO reports (target_type, target_id, reason, reporter_ip_hash) VALUES (?, ?, ?, ?)'
  ).bind(target_type, targetIdInt, reason, ipHash).run();

  const threshold = await db.prepare("SELECT value FROM settings WHERE key = 'auto_hide_report_threshold'").first();
  const thresholdVal = threshold ? parseInt(threshold.value) : 3;

  const reportCountRes = await db.prepare(
    'SELECT COUNT(*) as count FROM reports WHERE target_type = ? AND target_id = ? AND resolved = 0'
  ).bind(target_type, targetIdInt).first();
  const reportCount = reportCountRes ? reportCountRes.count : 0;

  if (reportCount >= thresholdVal) {
    const table = target_type === 'story' ? 'stories' : 'comments';
    await db.prepare(`UPDATE ${table} SET status = 'pending' WHERE id = ? AND status = 'approved'`).bind(targetIdInt).run();
  }

  return c.json({ message: 'Report submitted. Thank you for helping keep our community safe.' });
});

// ── POST /api/moderate/text ──
app.post('/api/moderate/text', async (c) => {
  const { text } = await c.req.json();
  if (!text) return c.json({ pii: [], crisis: { isCrisis: false } });
  const pii = detectPII(text);
  const crisis = detectCrisisLanguage(text);
  return c.json({ pii, crisis });
});

// ── GET /api/crisis-resources ──
app.get('/api/crisis-resources', (c) => {
  return c.json({
    disclaimer: 'This platform is peer support, NOT therapy or crisis intervention.',
    resources: [
      {
        category: 'United States Support',
        items: [
          { name: '988 Suicide & Crisis Lifeline', contact: '988', type: 'Call or Text', region: 'US', hours: '24/7' },
          { name: 'The Trevor Project (LGBTQ+ Youth)', contact: '1-866-488-7386', type: 'Call or Text (START to 678-678)', region: 'US', hours: '24/7' },
          { name: 'Crisis Text Line', contact: 'Text HOME to 741741', type: 'Text', region: 'US', hours: '24/7' },
          { name: 'National Domestic Violence Hotline', contact: '1-800-799-7233', type: 'Call or Text (START to 88788)', region: 'US', hours: '24/7' }
        ]
      },
      {
        category: 'India Support',
        items: [
          { name: 'Tele-MANAS (Govt Mental Health Helpline)', contact: '14416 or 1-800-891-4416', type: 'Call', region: 'India', hours: '24/7' },
          { name: 'Vandrevala Foundation Crisis Helpline', contact: '9999 666 555', type: 'Call or Chat', region: 'India', hours: '24/7' },
          { name: 'iCall (TISS Mental Health Helpline)', contact: '9152987821', type: 'Call (LGBTQ+-affirmative)', region: 'India', hours: 'Mon-Sat 10 AM - 8 PM' }
        ]
      }
    ]
  });
});

// ═════════════════════════════════════════════════════════
// ██  ADMIN API ROUTES
// ═════════════════════════════════════════════════════════

// ── POST /api/admin/login ──
app.post('/api/admin/login', rateLimit('admin-login', 10), async (c) => {
  const db = c.env.DB;
  const { username, password } = await c.req.json();

  const admin = await db.prepare('SELECT * FROM admin_users WHERE username = ?').bind(username).first();
  const passwordMatch = admin ? await bcrypt.compare(password, admin.password_hash) : false;
  if (!admin || !passwordMatch) {
    return c.json({ error: 'Invalid credentials.' }, 401);
  }

  if (admin.mfa_enabled) {
    const preToken = await signJWT({
      adminId: admin.id,
      username: admin.username,
      step: 'mfa',
      exp: Math.floor(Date.now() / 1000) + 5 * 60
    }, getJwtSecret(c));
    return c.json({ requireMFA: true, preToken });
  }

  const token = await signJWT({
    adminId: admin.id,
    username: admin.username,
    role: admin.role,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
  }, getJwtSecret(c));

  return c.json({ token, username: admin.username, role: admin.role, mfaEnabled: false });
});

// ── POST /api/admin/mfa-verify ──
app.post('/api/admin/mfa-verify', async (c) => {
  const db = c.env.DB;
  const { preToken, code } = await c.req.json();

  try {
    const preSession = await verifyJWT(preToken, getJwtSecret(c));
    if (preSession.step !== 'mfa') {
      return c.json({ error: 'Invalid or expired pre-auth token.' }, 401);
    }

    const admin = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(preSession.adminId).first();
    const isValid = authenticator.verify({ token: code, secret: admin.mfa_secret });

    if (!isValid) {
      return c.json({ error: 'Invalid MFA code.' }, 401);
    }

    const token = await signJWT({
      adminId: admin.id,
      username: admin.username,
      role: admin.role,
      exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
    }, getJwtSecret(c));

    return c.json({ token, username: admin.username, role: admin.role });
  } catch (err) {
    return c.json({ error: 'Invalid or expired pre-auth token.' }, 401);
  }
});

// ── POST /api/admin/mfa-setup ──
app.post('/api/admin/mfa-setup', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');

  const admin = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(adminPayload.adminId).first();
  const secret = admin.mfa_secret || authenticator.generateSecret();

  if (!admin.mfa_secret) {
    await db.prepare('UPDATE admin_users SET mfa_secret = ? WHERE id = ?').bind(secret, admin.id).run();
  }

  const otpauth = authenticator.keyuri(admin.email, 'LifeStories Admin', secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  return c.json({ secret, qrCode: qrDataUrl, email: admin.email });
});

// ── POST /api/admin/mfa-enable ──
app.post('/api/admin/mfa-enable', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const { code } = await c.req.json();

  const admin = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(adminPayload.adminId).first();

  const isValid = authenticator.verify({ token: code, secret: admin.mfa_secret });
  if (!isValid) {
    return c.json({ error: 'Invalid code. Please try again.' }, 400);
  }

  await db.prepare('UPDATE admin_users SET mfa_enabled = 1 WHERE id = ?').bind(admin.id).run();
  return c.json({ message: 'MFA enabled successfully.' });
});

// ── GET /api/admin/stats ──
app.get('/api/admin/stats', requireAdmin, async (c) => {
  const db = c.env.DB;

  const totalStories = (await db.prepare('SELECT COUNT(*) as c FROM stories').first()).c;
  const pendingStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'pending'").first()).c;
  const approvedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'approved'").first()).c;
  const rejectedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'rejected'").first()).c;
  const totalComments = (await db.prepare('SELECT COUNT(*) as c FROM comments').first()).c;
  const pendingComments = (await db.prepare("SELECT COUNT(*) as c FROM comments WHERE status = 'pending'").first()).c;
  const openReports = (await db.prepare('SELECT COUNT(*) as c FROM reports WHERE resolved = 0').first()).c;
  const totalLikes = (await db.prepare('SELECT COALESCE(SUM(like_count), 0) as c FROM stories').first()).c;
  const bannedIPs = (await db.prepare('SELECT COUNT(*) as c FROM banned_identifiers').first()).c;

  const { results: dailyStories } = await db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM stories
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all();

  return c.json({
    totalStories, pendingStories, approvedStories, rejectedStories,
    totalComments, pendingComments, openReports, totalLikes, bannedIPs,
    dailyStories
  });
});

// ── GET /api/admin/queue ──
app.get('/api/admin/queue', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { type = 'stories', status = 'pending' } = c.req.query();

  if (type === 'stories') {
    const { results } = await db.prepare(`
      SELECT s.*, c.name as category_name
      FROM stories s
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.status = ?
      ORDER BY s.created_at ASC
    `).bind(status).all();
    return c.json({ items: results, type: 'stories' });
  } else {
    const { results } = await db.prepare(`
      SELECT cm.*, s.title as story_title
      FROM comments cm
      LEFT JOIN stories s ON cm.story_id = s.id
      WHERE cm.status = ?
      ORDER BY cm.created_at ASC
    `).bind(status).all();
    return c.json({ items: results, type: 'comments' });
  }
});

// ── POST /api/admin/moderate ──
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

// ── GET /api/admin/reports ──
app.get('/api/admin/reports', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { resolved = '0' } = c.req.query();

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

// ── POST /api/admin/reports/:id/resolve ──
app.post('/api/admin/reports/:id/resolve', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const reportId = parseInt(c.req.param('id'));
  const { reason } = await c.req.json();

  await db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?').bind(reportId).run();

  await db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind('report', reportId, adminPayload.adminId, 'resolve_report', reason || null).run();

  return c.json({ message: 'Report resolved.' });
});

// ── POST /api/admin/ban ──
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

// ── GET /api/admin/bans ──
app.get('/api/admin/bans', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM banned_identifiers ORDER BY created_at DESC').all();
  return c.json(results);
});

// ── DELETE /api/admin/bans/:id ──
app.delete('/api/admin/bans/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM banned_identifiers WHERE id = ?').bind(id).run();
  return c.json({ message: 'Ban removed.' });
});

// ── GET /api/admin/audit-log ──
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

// ── GET /api/admin/settings ──
app.get('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM settings').all();
  const result = {};
  for (const s of results) {
    try { result[s.key] = JSON.parse(s.value); } catch { result[s.key] = s.value; }
  }
  return c.json(result);
});

// ── PUT /api/admin/settings ──
app.put('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const updates = await c.req.json();

  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');

  const batchStatements = [];
  for (const [key, value] of Object.entries(updates)) {
    const val = typeof value === 'object' ? JSON.stringify(value) : String(value);
    batchStatements.push(upsert.bind(key, val, val));
  }

  if (batchStatements.length > 0) {
    await db.batch(batchStatements);
  }

  await db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind('settings', 0, adminPayload.adminId, 'update_settings', `Updated keys: ${Object.keys(updates).join(', ')}`).run();

  return c.json({ message: 'Settings updated.' });
});

// ── GET /api/admin/categories ──
app.get('/api/admin/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM stories WHERE category_id = c.id) as story_count
    FROM categories c ORDER BY c.name
  `).all();
  return c.json(results);
});

// ── POST /api/admin/categories ──
app.post('/api/admin/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { name } = await c.req.json();
  if (!name) return c.json({ error: 'Name is required.' }, 400);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  try {
    await db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').bind(name, slug).run();
    return c.json({ message: 'Category created.' });
  } catch (e) {
    return c.json({ error: 'Category already exists.' }, 400);
  }
});

// ── DELETE /api/admin/categories/:id ──
app.delete('/api/admin/categories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('UPDATE stories SET category_id = NULL WHERE category_id = ?').bind(id).run();
  await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return c.json({ message: 'Category deleted.' });
});

// Export the Worker fetch handler
export default app;
