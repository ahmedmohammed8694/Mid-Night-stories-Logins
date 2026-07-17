// src/worker.js — Cloudflare Worker entry point for Midnight Stories
// Upgraded version: local auth, Google OAuth 2.0, profiles, followers, reads history, and likes tracking.

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

// ── In-Memory Rate Limiting ──
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
        message: `You can only make ${maxPerHour} ${type} requests per hour. Please try again later.`,
        retryAfter: Math.ceil((timestamps[0] + windowMs - now) / 1000)
      }, 429);
    }

    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
    await next();
  };
}

// ── JWT Secret Helpers ──
const getAdminJwtSecret = (c) => c.env.ADMIN_JWT_SECRET || 'midnight_stories_admin_secret_2026';
const getUserJwtSecret = (c) => c.env.JWT_SECRET || 'midnight_stories_user_secret_2026';

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
    c.set('user', payload);
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
      c.set('user', payload);
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
  const { full_name, email, password } = await c.req.json();

  if (!full_name || !email || !password) {
    return c.json({ error: 'All fields are required.' }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters.' }, 400);
  }

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already in use.' }, 400);

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.prepare(
    'INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)'
  ).bind(full_name, email, passwordHash).run();

  const userId = result.meta.last_row_id;
  const token = await signJWT({ id: userId, email }, getUserJwtSecret(c));

  return c.json({ token, user: { id: userId, full_name, email } }, 201);
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
  return c.json({ token, user: { id: user.id, full_name: user.full_name, email: user.email } });
});

app.get('/api/auth/me', requireUser, async (c) => {
  const db = c.env.DB;
  const userPayload = c.get('user');
  const user = await db.prepare('SELECT id, full_name, email, profile_pic FROM users WHERE id = ?').bind(userPayload.id).first();
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

  if (!user) {
    const insert = await db.prepare(
      'INSERT INTO users (full_name, email, google_id, profile_pic) VALUES (?, ?, ?, ?)'
    ).bind(profile.name, profile.email, profile.id, profile.picture).run();
    userId = insert.meta.last_row_id;
  } else {
    userId = user.id;
    if (!user.google_id) {
      await db.prepare('UPDATE users SET google_id = ? WHERE id = ?').bind(profile.id, userId).run();
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

app.get('/api/stories', optionalUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const { sort = 'newest', category, search, page = 1, limit = 12, feed, userId } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);

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
    case 'liked': orderBy = 's.likes_count DESC'; break;
    default: orderBy = 's.created_at DESC';
  }

  const countSql = `SELECT COUNT(*) as total FROM stories s LEFT JOIN categories c ON s.category_id = c.id ${where}`;
  const countRes = await db.prepare(countSql).bind(...params).first();
  const total = countRes ? countRes.total : 0;

  const sql = `
    SELECT s.*, u.full_name as author_name, u.profile_pic as author_pic, c.name as category_name, c.slug as category_slug
    FROM stories s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN categories c ON s.category_id = c.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const { results: stories } = await db.prepare(sql).bind(...params, parseInt(limit), offset).all();

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

app.post('/api/stories', requireUser, checkBan, rateLimit('story', 5), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  let title, content, categoryIdStr, imageFile;
  const contentType = c.req.header('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const json = await c.req.json();
    title = json.title;
    content = json.content || json.body;
    categoryIdStr = json.category_id;
  } else {
    const formData = await c.req.formData();
    title = formData.get('title');
    content = formData.get('content') || formData.get('body');
    categoryIdStr = formData.get('category_id');
    imageFile = formData.get('image');
  }

  if (!content || content.trim().length < 50) {
    return c.json({ error: 'Story must be at least 50 characters long.' }, 400);
  }

  let bannedKeywords = [];
  try {
    const setting = await db.prepare("SELECT value FROM settings WHERE key = 'banned_keywords'").first();
    if (setting) bannedKeywords = JSON.parse(setting.value);
  } catch (e) {}

  const modResult = moderateText(content, bannedKeywords);
  if (modResult.autoAction === 'reject') {
    return c.json({ error: 'Your submission contains content that violates guidelines.' }, 400);
  }

  let imageUrl = null;
  if (imageFile && imageFile instanceof File && imageFile.size > 0) {
    if (imageFile.size > 5 * 1024 * 1024) return c.json({ error: 'File size must be under 5MB.' }, 400);
    const safetyCheck = checkImageSafety(imageFile);
    if (!safetyCheck.safe) return c.json({ error: 'Uploaded image did not pass safety checks.' }, 400);

    if (c.env.IMAGES) {
      const ext = imageFile.type.split('/')[1] || 'jpg';
      const filename = `${crypto.randomUUID()}.${ext}`;
      await c.env.IMAGES.put(filename, await imageFile.arrayBuffer(), { httpMetadata: { contentType: imageFile.type } });
      imageUrl = `/uploads/${filename}`;
    }
  }

  const result = await db.prepare(
    'INSERT INTO stories (user_id, title, content, category_id, image_url, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(user.id, title ? title.trim() : null, modResult.redactedText, categoryIdStr ? parseInt(categoryIdStr) : null, imageUrl, 'approved').run();

  return c.json({ id: result.meta.last_row_id, status: 'approved', message: 'Your story has been published.' }, 201);
});

// GET /api/stories/:id
app.get('/api/stories/:id', optionalUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');

  const story = await db.prepare(`
    SELECT s.*, u.full_name as author_name, u.profile_pic as author_pic, c.name as category_name
    FROM stories s
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN categories c ON s.category_id = c.id
    WHERE s.id = ? AND s.status = 'approved'
  `).bind(id).first();

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Track reads history if logged in
  if (user) {
    await db.prepare('INSERT OR IGNORE INTO reads (user_id, story_id) VALUES (?, ?)').bind(user.id, id).run();
  }

  const { results: comments } = await db.prepare(`
    SELECT cm.*, u.full_name as author_name, u.profile_pic as author_pic
    FROM comments cm
    LEFT JOIN users u ON cm.user_id = u.id
    WHERE cm.story_id = ? AND cm.status = 'approved' 
    ORDER BY cm.created_at ASC
  `).bind(id).all();

  return c.json({ story, comments });
});

// POST /api/stories/:id/like
app.post('/api/stories/:id/like', requireUser, checkBan, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const storyId = parseInt(c.req.param('id'));

  const story = await db.prepare('SELECT id FROM stories WHERE id = ? AND status = "approved"').bind(storyId).first();
  if (!story) return c.json({ error: 'Story not found.' }, 404);

  const existingLike = await db.prepare('SELECT id FROM likes WHERE user_id = ? AND story_id = ?').bind(user.id, storyId).first();

  if (existingLike) {
    await db.prepare('DELETE FROM likes WHERE id = ?').bind(existingLike.id).run();
    await db.prepare('UPDATE stories SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').bind(storyId).run();
    const updated = await db.prepare('SELECT likes_count FROM stories WHERE id = ?').bind(storyId).first();
    return c.json({ liked: false, likes_count: updated.likes_count });
  }

  await db.prepare('INSERT INTO likes (user_id, story_id) VALUES (?, ?)').bind(user.id, storyId).run();
  await db.prepare('UPDATE stories SET likes_count = likes_count + 1 WHERE id = ?').bind(storyId).run();
  const updated = await db.prepare('SELECT likes_count FROM stories WHERE id = ?').bind(storyId).first();
  return c.json({ liked: true, likes_count: updated.likes_count });
});

// ═════════════════════════════════════════════════════════
// ██  USER PROFILES & SOCIAL CAPABILITIES
// ═════════════════════════════════════════════════════════
app.get('/api/users/:id', optionalUser, async (c) => {
  const db = c.env.DB;
  const targetId = parseInt(c.req.param('id'));
  const loggedInUser = c.get('user');

  const user = await db.prepare('SELECT id, full_name, bio, profile_pic, created_at FROM users WHERE id = ?').bind(targetId).first();
  if (!user) return c.json({ error: 'User not found.' }, 404);

  const followers = (await db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').bind(targetId).first()).c;
  const following = (await db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').bind(targetId).first()).c;

  user.followers_count = followers;
  user.following_count = following;

  if (loggedInUser) {
    const isFollowing = await db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').bind(loggedInUser.id, targetId).first();
    user.is_following = !!isFollowing;
  }

  return c.json(user);
});

app.post('/api/users/:id/follow', requireUser, async (c) => {
  const db = c.env.DB;
  const loggedInUser = c.get('user');
  const targetId = parseInt(c.req.param('id'));

  if (loggedInUser.id === targetId) return c.json({ error: 'You cannot follow yourself.' }, 400);

  const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'User not found.' }, 404);

  const existing = await db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').bind(loggedInUser.id, targetId).first();

  if (existing) {
    await db.prepare('DELETE FROM follows WHERE id = ?').bind(existing.id).run();
    return c.json({ following: false });
  }

  await db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').bind(loggedInUser.id, targetId).run();
  return c.json({ following: true });
});

// Stats public block fallback
app.get('/api/stats/public', async (c) => {
  const db = c.env.DB;
  const [storyStats, visitorRow, commentRow] = await Promise.all([
    db.prepare(`
      SELECT
        COALESCE(SUM(likes_count), 0)    AS total_likes,
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

app.get('/api/admin/users', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT id, full_name, email, created_at FROM users ORDER BY created_at DESC').all();
  return c.json(results);
});

app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ message: 'User deleted successfully.' });
});

app.get('/api/admin/stats', requireAdmin, async (c) => {
  const db = c.env.DB;

  const totalStories = (await db.prepare('SELECT COUNT(*) as c FROM stories').first()).c;
  const pendingStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'pending'").first()).c;
  const totalComments = (await db.prepare('SELECT COUNT(*) as c FROM comments').first()).c;
  const totalUsers = (await db.prepare('SELECT COUNT(*) as c FROM users').first()).c;
  const totalLikes = (await db.prepare('SELECT COALESCE(SUM(likes_count), 0) as c FROM stories').first()).c;

  return c.json({
    totalStories, pendingStories, totalComments, totalUsers, totalLikes
  });
});

app.get('/api/admin/queue', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { type = 'stories', status = 'pending' } = c.req.query();

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

  const statusMap = { approve: 'approved', reject: 'rejected', remove: 'removed' };
  const table = target_type === 'story' ? 'stories' : 'comments';
  const targetIdInt = parseInt(target_id);

  await db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).bind(statusMap[action], targetIdInt).run();

  await db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind(target_type, targetIdInt, adminPayload.adminId, action, reason || null).run();

  return c.json({ message: `Content ${statusMap[action]} successfully.` });
});

export default app;
