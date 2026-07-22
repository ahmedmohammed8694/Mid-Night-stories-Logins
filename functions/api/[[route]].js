import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { sign, verify } from 'hono/jwt';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

import {
  moderateText, hashIP, detectCrisisLanguage, detectPII, checkImageSafety
} from '../moderation';

const app = new Hono().basePath('/api');

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
    const payload = await verify(token, getJwtSecret(c));
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
// ██  PUBLIC API ROUTES
// ═════════════════════════════════════════════════════════

// ── GET /api/categories ──
app.get('/categories', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM categories ORDER BY name').all();
  return c.json(results);
});

// ── GET /api/stories ──
app.get('/stories', async (c) => {
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
app.get('/stories/:id', async (c) => {
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
app.post('/stories', checkBan, rateLimit('story', 5), async (c) => {
  const db = c.env.DB;
  const ipHash = c.get('ipHash');
  
  // Parse multipart form data
  const formData = await c.req.formData();
  const title = formData.get('title');
  const body = formData.get('body');
  const categoryIdStr = formData.get('category_id');
  const ageConfirmed = formData.get('age_confirmed');
  const imageFile = formData.get('image'); // File object

  if (!body || body.trim().length < 50) {
    return c.json({ error: 'Story must be at least 50 characters long.' }, 400);
  }

  if (!ageConfirmed || ageConfirmed !== 'true') {
    return c.json({ error: 'You must confirm you are 18 or older.' }, 400);
  }

  // Get banned keywords from settings
  let bannedKeywords = [];
  try {
    const setting = await db.prepare("SELECT value FROM settings WHERE key = 'banned_keywords'").first();
    if (setting) bannedKeywords = JSON.parse(setting.value);
  } catch (e) { /* ignore */ }

  // Run moderation
  const modResult = moderateText(body, bannedKeywords);
  const titleModResult = title ? moderateText(title, bannedKeywords) : null;

  if (modResult.autoAction === 'reject' || (titleModResult && titleModResult.autoAction === 'reject')) {
    return c.json({
      error: 'Your submission contains content that violates our community guidelines.',
      flags: [...modResult.flags, ...(titleModResult?.flags || [])]
    }, 400);
  }

  // Crisis language check
  const crisisResult = detectCrisisLanguage(body);

  // Process image if uploaded and bound to R2
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
    } else {
      console.warn("R2 IMAGES bucket binding is missing. Image upload skipped.");
    }
  }

  const submitterToken = crypto.randomUUID();

  // Determine status
  const requireApproval = await db.prepare("SELECT value FROM settings WHERE key = 'require_manual_approval'").first();
  let status = 'pending';
  if (requireApproval && requireApproval.value === 'false' && modResult.autoAction === 'approve' && !crisisResult.isCrisis) {
    status = 'approved';
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

  // Log moderation flags
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
app.post('/stories/:id/comments', checkBan, rateLimit('comment', 15), async (c) => {
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

  const requireApproval = await db.prepare("SELECT value FROM settings WHERE key = 'require_manual_approval'").first();
  let status = 'pending';
  if (requireApproval && requireApproval.value === 'false' && modResult.autoAction === 'approve') {
    status = 'approved';
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
app.post('/stories/:id/like', checkBan, rateLimit('like', 60), async (c) => {
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
    // Unlike
    await db.prepare('DELETE FROM likes WHERE id = ?').bind(existingLike.id).run();
    await db.prepare('UPDATE stories SET like_count = MAX(0, like_count - 1) WHERE id = ?').bind(storyId).run();
    const updated = await db.prepare('SELECT like_count FROM stories WHERE id = ?').bind(storyId).first();
    return c.json({ liked: false, like_count: updated.like_count });
  }

  // Like
  await db.prepare('INSERT INTO likes (story_id, ip_hash) VALUES (?, ?)').bind(storyId, ipHash).run();
  await db.prepare('UPDATE stories SET like_count = like_count + 1 WHERE id = ?').bind(storyId).run();
  const updated = await db.prepare('SELECT like_count FROM stories WHERE id = ?').bind(storyId).first();
  return c.json({ liked: true, like_count: updated.like_count });
});

// ── POST /api/reports ──
app.post('/reports', checkBan, rateLimit('report', 10), async (c) => {
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

  // Auto-hide if report threshold exceeded
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
app.post('/moderate/text', async (c) => {
  const { text } = await c.req.json();
  if (!text) return c.json({ pii: [], crisis: { isCrisis: false } });

  const pii = detectPII(text);
  const crisis = detectCrisisLanguage(text);
  return c.json({ pii, crisis });
});

// ── GET /api/crisis-resources ──
app.get('/crisis-resources', (c) => {
  return c.json({
    disclaimer: 'This platform is peer support, NOT therapy or crisis intervention. If you are in immediate danger, please contact local emergency services (911 in the US, 112 in India) or one of the resources below.',
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

// ── ONE-TIME ADMIN SETUP (POST /api/admin/setup) ──
// Creates the default admin user if none exists yet.
// Auto-disables once any admin user is present. Safe to leave in code.
app.post('/admin/setup', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));

  if (body.secret !== 'MIDNIGHT_SETUP_2026') {
    return c.json({ error: 'Forbidden.' }, 403);
  }

  const existing = await db.prepare('SELECT COUNT(*) as cnt FROM admin_users').first();
  if (existing && existing.cnt > 0) {
    return c.json({ error: 'Admin already configured. Endpoint disabled.' }, 409);
  }

  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('Admin@2026!', 10);

  await db.prepare(
    `INSERT INTO admin_users (username, email, password_hash, mfa_secret, mfa_enabled, role)
     VALUES ('admin', 'admin@midnightstories.com', ?, 'JBSWY3DPEHPK3PXP', 0, 'superadmin')`
  ).bind(hash).run();

  return c.json({
    success: true,
    username: 'admin',
    password: 'Admin@2026!',
    note: 'Admin created. This endpoint is now permanently disabled.'
  });
});

// ── POST /api/admin/login ──
app.post('/admin/login', rateLimit('admin-login', 10), async (c) => {
  const db = c.env.DB;
  const { username, password } = await c.req.json();
  const bcrypt = require('bcryptjs');

  const admin = await db.prepare('SELECT * FROM admin_users WHERE username = ?').bind(username).first();
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return c.json({ error: 'Invalid credentials.' }, 401);
  }

  if (admin.mfa_enabled) {
    // Generate stateless pre-auth JWT token for MFA step
    const preToken = await sign({
      adminId: admin.id,
      username: admin.username,
      step: 'mfa',
      exp: Math.floor(Date.now() / 1000) + 5 * 60 // 5 minutes
    }, getJwtSecret(c));
    return c.json({ requireMFA: true, preToken });
  }

  // Generate full admin session JWT token
  const token = await sign({
    adminId: admin.id,
    username: admin.username,
    role: admin.role,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 // 8 hours
  }, getJwtSecret(c));

  return c.json({ token, username: admin.username, role: admin.role, mfaEnabled: false });
});

// ── POST /api/admin/mfa-verify ──
app.post('/admin/mfa-verify', async (c) => {
  const db = c.env.DB;
  const { preToken, code } = await c.req.json();

  try {
    const preSession = await verify(preToken, getJwtSecret(c));
    if (preSession.step !== 'mfa') {
      return c.json({ error: 'Invalid or expired pre-auth token.' }, 401);
    }

    const admin = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(preSession.adminId).first();
    const isValid = authenticator.verify({ token: code, secret: admin.mfa_secret });

    if (!isValid) {
      return c.json({ error: 'Invalid MFA code.' }, 401);
    }

    const token = await sign({
      adminId: admin.id,
      username: admin.username,
      role: admin.role,
      exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 // 8 hours
    }, getJwtSecret(c));

    return c.json({ token, username: admin.username, role: admin.role });
  } catch (err) {
    return c.json({ error: 'Invalid or expired pre-auth token.' }, 401);
  }
});

// ── POST /api/admin/mfa-setup ──
app.post('/admin/mfa-setup', requireAdmin, async (c) => {
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
app.post('/admin/mfa-enable', requireAdmin, async (c) => {
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
app.get('/admin/stats', requireAdmin, async (c) => {
  const db = c.env.DB;

  const totalStories = (await db.prepare('SELECT COUNT(*) as c FROM stories').first()).c;
  const pendingStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'pending'").first()).c;
  const approvedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'approved'").first()).c;
  const rejectedStories = (await db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'rejected'").first()).c;
  const totalComments = (await db.prepare('SELECT COUNT(*) as c FROM comments').first()).c;
  const pendingComments = (await db.prepare("SELECT COUNT(*) as c FROM comments WHERE status = 'pending'").first()).c;
  const totalUsers = (await db.prepare('SELECT COUNT(*) as c FROM users').first()).c;
  const openReports = (await db.prepare("SELECT COUNT(*) as c FROM reports WHERE ticket_status != 'resolved' AND ticket_status != 'closed'").first()).c;
  const totalLikes = (await db.prepare('SELECT COALESCE(SUM(like_count), 0) as c FROM stories').first()).c;
  const bannedIPs = (await db.prepare('SELECT COUNT(*) as c FROM banned_identifiers').first()).c;

  // Book stats
  const totalBooks = (await db.prepare('SELECT COUNT(*) as c FROM books').first()).c;
  const pendingBooks = (await db.prepare("SELECT COUNT(*) as c FROM books WHERE is_user_submission = 1 AND submission_status = 'pending'").first()).c;
  const totalCategories = (await db.prepare('SELECT COUNT(*) as c FROM categories').first()).c;

  // Stories per day (last 7 days)
  const { results: dailyStories } = await db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM stories
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all();

  return c.json({
    totalStories, pendingStories, approvedStories, rejectedStories,
    totalComments, pendingComments, totalUsers, openReports, totalLikes, bannedIPs,
    totalBooks, pendingBooks, totalCategories,
    dailyStories
  });
});

// ── GET /api/admin/queue ──
app.get('/admin/queue', requireAdmin, async (c) => {
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
app.post('/admin/moderate', requireAdmin, async (c) => {
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

  // Update comment count if approving/rejecting a comment
  if (target_type === 'comment') {
    const comment = await db.prepare('SELECT story_id FROM comments WHERE id = ?').bind(targetIdInt).first();
    if (comment) {
      const count = (await db.prepare("SELECT COUNT(*) as c FROM comments WHERE story_id = ? AND status = 'approved'").bind(comment.story_id).first()).c;
      await db.prepare('UPDATE stories SET comment_count = ? WHERE id = ?').bind(count, comment.story_id).run();
    }
  }

  // Log the action
  await db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind(target_type, targetIdInt, adminPayload.adminId, action, reason || null).run();

  return c.json({ message: `Content ${statusMap[action]} successfully.` });
});

// ── GET /api/admin/reports ──
app.get('/admin/reports', requireAdmin, async (c) => {
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
app.post('/admin/reports/:id/resolve', requireAdmin, async (c) => {
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
app.post('/admin/ban', requireAdmin, async (c) => {
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
app.get('/admin/bans', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM banned_identifiers ORDER BY created_at DESC').all();
  return c.json(results);
});

// ── DELETE /api/admin/bans/:id ──
app.delete('/admin/bans/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));

  await db.prepare('DELETE FROM banned_identifiers WHERE id = ?').bind(id).run();
  return c.json({ message: 'Ban removed.' });
});

// ── GET /api/admin/audit-log ──
app.get('/admin/audit-log', requireAdmin, async (c) => {
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
app.get('/admin/settings', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM settings').all();
  const result = {};
  for (const s of results) {
    try { result[s.key] = JSON.parse(s.value); } catch { result[s.key] = s.value; }
  }
  return c.json(result);
});

// ── PUT /api/admin/settings ──
app.put('/admin/settings', requireAdmin, async (c) => {
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
app.get('/admin/categories', requireAdmin, async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM stories WHERE category_id = c.id) as story_count
    FROM categories c ORDER BY c.name
  `).all();
  return c.json(results);
});

// ── POST /api/admin/categories ──
app.post('/admin/categories', requireAdmin, async (c) => {
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
app.delete('/admin/categories/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));

  await db.prepare('UPDATE stories SET category_id = NULL WHERE category_id = ?').bind(id).run();
  await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  
  return c.json({ message: 'Category deleted.' });
});

export const onRequest = handle(app);
