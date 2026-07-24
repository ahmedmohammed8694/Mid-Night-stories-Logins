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
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://static.cloudflareinsights.com https://challenges.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' wss: https:; frame-src 'self' https://challenges.cloudflare.com;"
    );
    
    // Reconstruct response with modified headers (bypassing immutability)
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers: newHeaders
    });
  }
});

// ── Navigation Redirects & Clean Slug Routing ──
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

app.get('/robots.txt', (c) => {
  const robots = `User-agent: *\nDisallow: /admin\nDisallow: /admin.html\nDisallow: /api/\nDisallow: /login?*\nDisallow: /*?*\n\nSitemap: https://midnightstories.dpdns.org/sitemap.xml\n`;
  return new Response(robots, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
});

app.get('/naval-books', (c) => c.redirect('/books?category=naval', 301));
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
    const db = c.env.DB;
    const userRow = await db.prepare('SELECT interaction_permissions FROM users WHERE id = ?').bind(payload.id).first();
    const permissions = userRow && userRow.interaction_permissions ? JSON.parse(userRow.interaction_permissions) : {};
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
      const permissions = userRow && userRow.interaction_permissions ? JSON.parse(userRow.interaction_permissions) : {};
      c.set('user', { ...payload, permissions });
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
    return c.json({ error: 'Database submission error: ' + err.message }, 500);
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

  // Privacy Protection logic
  const isOwner = loggedInUser && loggedInUser.id === targetId;
  if (!isOwner) {
    user.email = undefined;
    user.phone_number = undefined;
  }

  return c.json(user);
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

    if (!c.env.IMAGES) {
      return c.json({ error: 'Storage bucket (R2) is not configured.' }, 500);
    }

    const ext = file.type.split('/')[1] || 'jpg';
    const filename = `profile_${userPayload.id}_${Date.now()}.${ext}`;

    await c.env.IMAGES.put(filename, await file.arrayBuffer(), {
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
  const { results } = await db.prepare('SELECT id, user_id, full_name, email, account_status, created_at FROM users ORDER BY created_at DESC').all();
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

  return c.json({
    totalStories, pendingStories, approvedStories, rejectedStories,
    totalComments, pendingComments, totalUsers, totalLikes,
    openReports, bannedIPs,
    totalBooks, pendingBooks, totalCategories
  });
});

app.get('/api/admin/queue', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { type = 'stories', status = 'pending' } = c.req.query();

  if (type === 'stories') {
    let sql = `
      SELECT s.id, s.user_id, s.title, s.content AS body, s.category_id, s.image_url, s.status, s.submitter_token, s.ip_hash, s.like_count, s.comment_count, s.created_at, s.updated_at, c.name as category_name, u.full_name as author_name
      FROM stories s
      LEFT JOIN categories c ON s.category_id = c.id
      LEFT JOIN users u ON s.user_id = u.id
    `;
    let bindings = [];
    if (status && status !== 'all') {
      sql += ` WHERE s.status = ? `;
      bindings.push(status);
    }
    sql += ` ORDER BY s.created_at DESC `;
    const { results } = await db.prepare(sql).bind(...bindings).all();
    return c.json({ items: results, type: 'stories' });
  } else {
    let sql = `
      SELECT cm.id, cm.story_id, cm.user_id, cm.content AS body, cm.status, cm.ip_hash, cm.created_at, s.title as story_title, u.full_name as author_name
      FROM comments cm
      LEFT JOIN stories s ON cm.story_id = s.id
      LEFT JOIN users u ON cm.user_id = u.id
    `;
    let bindings = [];
    if (status && status !== 'all') {
      sql += ` WHERE cm.status = ? `;
      bindings.push(status);
    }
    sql += ` ORDER BY cm.created_at DESC `;
    const { results } = await db.prepare(sql).bind(...bindings).all();
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
  const { name } = await c.req.json();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
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
  await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return c.json({ message: 'Category deleted.' });
});

// ── Bans ──
app.get('/api/admin/bans', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM banned_identifiers ORDER BY created_at DESC').all();
  return c.json(results);
});

app.post('/api/admin/ban', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { identifier, reason, type = 'ip' } = await c.req.json();
  await db.prepare('INSERT INTO banned_identifiers (identifier, type, reason) VALUES (?, ?, ?)')
    .bind(identifier, type, reason).run();
  return c.json({ message: 'Ban added.' });
});

app.delete('/api/admin/bans/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  await db.prepare('DELETE FROM banned_identifiers WHERE id = ?').bind(id).run();
  return c.json({ message: 'Ban removed.' });
});

// ── Settings ──
app.get('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM settings').all();
  const settings = {};
  results.forEach(r => settings[r.key] = r.value);
  return c.json(settings);
});

app.put('/api/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const updates = await c.req.json();
  
  const stmts = [];
  for (const [key, value] of Object.entries(updates)) {
    const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    stmts.push(db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, strValue));
  }
  await db.batch(stmts);
  return c.json({ message: 'Settings saved.' });
});

// ── Reports ──
app.post('/api/reports', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  
  try {
    const formData = await c.req.formData();
    const target_type = formData.get('target_type') || formData.get('reported_item_type');
    const target_id = parseInt(formData.get('target_id') || formData.get('reported_item_id'));
    const reason = formData.get('reason');
    const details = formData.get('details') || null;
    const file = formData.get('attachment');
    let attachment_url = null;

    if (!target_type || !target_id || !reason) {
      return c.json({ success: false, error: 'Missing required fields.' }, 400);
    }

    if (file && file instanceof File) {
      if (file.size > 5 * 1024 * 1024) {
        return c.json({ success: false, error: 'Max file size is 5MB.' }, 400);
      }
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        return c.json({ success: false, error: 'Only JPEG, PNG and WEBP are allowed.' }, 400);
      }
      if (c.env.IMAGES) {
        const ext = file.type.split('/')[1] || 'jpg';
        const filename = `report_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
        await c.env.IMAGES.put(filename, await file.arrayBuffer(), {
          httpMetadata: { contentType: file.type }
        });
        attachment_url = `/uploads/${filename}`;
      }
    }

    const ticket_id = 'TKT-' + Math.floor(1000 + Math.random() * 9000) + '-' + Date.now().toString().slice(-4);
    
    await db.prepare('INSERT INTO reports (ticket_id, reported_item_type, reported_item_id, reason, report_description, attachment_url, reporter_id, reporter_ip_hash, ticket_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ticket_id, target_type, target_id, reason, details, attachment_url, user.id, c.req.header('cf-connecting-ip') || '0.0.0.0', 'open')
      .run();

    return c.json({ success: true, ticket_id });
  } catch (err) {
    console.error('POST /api/reports ERROR:', err);
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  }
});
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

app.post('/api/admin/reports/:id/status', requireAdmin, async (c) => {
  const db = c.env.DB;
  const adminPayload = c.get('admin');
  const id = parseInt(c.req.param('id'));
  const { status, action } = await c.req.json().catch(() => ({}));

  await db.prepare(`
    UPDATE reports 
    SET ticket_status = ?, enforcement_action = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status || 'resolved', action || null, adminPayload.adminId, id).run();
  
  return c.json({ message: 'Ticket status updated.' });
});

app.get('/api/user/tickets', requireUser, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const { results } = await db.prepare('SELECT id, ticket_id, reported_item_type, reason, ticket_status, created_at FROM reports WHERE reporter_id = ? ORDER BY created_at DESC').bind(user.id).all();
  return c.json(results);
});

app.get('/api/tickets/:id/messages', async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  
  const report = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return c.json({ error: 'Ticket not found' }, 404);
  
  const { results } = await db.prepare('SELECT * FROM ticket_conversation_threads WHERE report_id = ? ORDER BY created_at ASC').bind(id).all();
  return c.json({ ticket: report, messages: results });
});

app.post('/api/tickets/:id/reply', async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  
  let sender_id, sender_role;
  let token = c.req.header('x-admin-token') || c.req.cookie('admin_token');
  
  if (token) {
    try {
      const payload = await verifyJWT(token, getAdminJwtSecret(c));
      if (payload.adminId) {
        sender_id = payload.adminId;
        sender_role = 'admin';
      }
    } catch (err) {
      // Not a valid admin token, try user token next
    }
  }

  if (!sender_role) {
    const authHeader = c.req.header('Authorization');
    token = (authHeader && authHeader.split(' ')[1]) || c.req.cookie('auth_token');
    if (token) {
      try {
        const payload = await verifyJWT(token, getUserJwtSecret(c));
        if (payload.id) {
          sender_id = payload.id;
          sender_role = 'user';
        }
      } catch (err) {
        return c.json({ error: 'Invalid token' }, 401);
      }
    }
  }

  if (!sender_role) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { message_body } = await c.req.json();
  if (!message_body) return c.json({ error: 'Message required' }, 400);

  await db.prepare('INSERT INTO ticket_conversation_threads (report_id, sender_id, sender_role, message_body) VALUES (?, ?, ?, ?)')
    .bind(id, sender_id, sender_role, message_body).run();

  if (sender_role === 'admin') {
    await db.prepare('UPDATE reports SET ticket_status = ? WHERE id = ?').bind('waiting_on_user', id).run();
    try {
      const reportRow = await db.prepare('SELECT reporter_id, ticket_id FROM reports WHERE id = ?').bind(id).first();
      if (reportRow && reportRow.reporter_id) {
        await db.prepare(`
          INSERT INTO notifications (user_id, type, source_id, read)
          VALUES (?, 'ticket_reply', ?, 0)
        `).bind(reportRow.reporter_id, id).run();
      }
    } catch (e) {
      console.warn('Failed to insert admin reply notification:', e);
    }
  } else {
    await db.prepare('UPDATE reports SET ticket_status = ? WHERE id = ?').bind('investigating', id).run();
  }

  return c.json({ success: true });
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
  const qrCode = await QRCode.toDataURL(otpauth);
  
  // Store secret temporarily (we assume admin will verify immediately)
  // In a robust system, store it in the DB as unverified until confirmed
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
    
    const token = await signJWT({ adminId: admin.id, username: admin.username, role: admin.role, exp: Math.floor(Date.now() / 1000) + 28800 }, getAdminJwtSecret(c));
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

app.post('/api/admin/users/:id/force-unblock', requireAdmin, async (c) => {
  const db = c.env.DB;
  const blockerId = parseInt(c.req.param('id'));
  const { blocked_id } = await c.req.json();
  
  await db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(blockerId, blocked_id).run();
  return c.json({ message: 'Force unblock successful.' });
});

app.post('/api/admin/users/:id/reset-connections', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = parseInt(c.req.param('id'));
  
  await db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').bind(userId, userId).run();
  await db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').bind(userId, userId).run();
  
  return c.json({ message: 'All connections reset.' });
});

app.put('/api/admin/users/:id/dm-permission', requireAdmin, async (c) => {
  const db = c.env.DB;
  const userId = parseInt(c.req.param('id'));
  const { dm_permission } = await c.req.json();
  
  await db.prepare('UPDATE users SET dm_permission = ? WHERE id = ?').bind(dm_permission, userId).run();
  return c.json({ message: `DM permission updated to ${dm_permission}.` });
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
  
  // Create a notification for the user
  await db.prepare(`
    INSERT INTO notifications (user_id, type, content) 
    VALUES (?, 'chat_message', ?)
  `).bind(userId, `SYSTEM WARNING: You have received a ${level}. Reason: ${reason}`).run();
  
  return c.json({ message: 'Warning issued.' });
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
  const { user_id, title, body } = await c.req.json();
  const adminPayload = c.get('admin');
  
  await db.prepare('INSERT INTO admin_messages (user_id, admin_id, title, body) VALUES (?, ?, ?, ?)').bind(parseInt(user_id), adminPayload.adminId, title, body).run();
  return c.json({ message: 'Message sent successfully.' });
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

  if (role === 'admin') {
    approvedBy = admin.adminId;
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

  if (role !== 'admin' && book.uploaded_by !== user.id) {
    return c.json({ error: 'Unauthorized to edit this book.' }, 403);
  }

  const {
    title, author, description, publisher, language, isbn,
    published_date, page_count, est_read_minutes, visibility, status
  } = body;

  let finalStatus = status || book.status;
  if (role !== 'admin') {
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

  if (role !== 'admin' && book.uploaded_by !== user.id) {
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
        const channelType = ['education', 'naval'].includes(item.channel_type) ? item.channel_type : 'education';

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
    return c.json({ error: 'Failed to process bulk book upload: ' + err.message }, 500);
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
    return c.json({ error: 'Failed to update book: ' + err.message }, 500);
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
  if (channel_type !== 'education' && channel_type !== 'naval') {
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

  if (channel_type !== 'education' && channel_type !== 'naval') {
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

app.notFound(async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

export default app;







