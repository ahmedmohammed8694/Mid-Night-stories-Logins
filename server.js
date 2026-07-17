// server.js — Express API server for Anonymous Life Stories Platform
const express = require('express');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const fs = require('fs');
const crypto = require('crypto');

const { getDb, initializeDatabase } = require('./database');
const {
  moderateText, hashIP, detectCrisisLanguage, detectPII, checkImageSafety
} = require('./moderation');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Ensure directories exist ──
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Middleware ──
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate Limiting (In-Memory) ──
const rateLimitMap = new Map();

function rateLimit(type, maxPerHour) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `${type}:${ip}`;
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour

    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, []);
    }

    const timestamps = rateLimitMap.get(key).filter(t => now - t < windowMs);
    if (timestamps.length >= maxPerHour) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `You can only make ${maxPerHour} ${type} requests per hour. Please try again later.`,
        retryAfter: Math.ceil((timestamps[0] + windowMs - now) / 1000)
      });
    }

    timestamps.push(now);
    rateLimitMap.set(key, timestamps);
    next();
  };
}

// ── File Upload Config ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WebP images are allowed'));
    }
  }
});

// ── Admin Session Management (Simple Token-Based) ──
const adminSessions = new Map();

function generateAdminToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  req.admin = adminSessions.get(token);
  next();
}

// ── Ban Check Middleware ──
function checkBan(req, res, next) {
  const db = getDb();
  const ipHash = hashIP(req.ip || req.connection.remoteAddress);
  const ban = db.prepare(
    'SELECT * FROM banned_identifiers WHERE identifier = ? AND (expires_at IS NULL OR expires_at > datetime("now"))'
  ).get(ipHash);
  if (ban) {
    return res.status(403).json({
      error: 'Access restricted',
      message: 'Your access has been restricted due to a policy violation.'
    });
  }
  next();
}

// ═════════════════════════════════════════════════════════
// ██  PUBLIC API ROUTES
// ═════════════════════════════════════════════════════════

// ── GET /api/categories ──
app.get('/api/categories', (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.json(categories);
});

// ── GET /api/stories ──
app.get('/api/stories', (req, res) => {
  const db = getDb();
  const { sort = 'newest', category, search, page = 1, limit = 12 } = req.query;
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
  const total = db.prepare(countSql).get(...params).total;

  const sql = `
    SELECT s.*, c.name as category_name, c.slug as category_slug
    FROM stories s
    LEFT JOIN categories c ON s.category_id = c.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const stories = db.prepare(sql).all(...params, parseInt(limit), offset);

  res.json({
    stories: stories.map(s => ({
      ...s,
      body_preview: s.body.substring(0, 200) + (s.body.length > 200 ? '...' : '')
    })),
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit))
  });
});

// ── GET /api/stories/:id ──
app.get('/api/stories/:id', (req, res) => {
  const db = getDb();
  const story = db.prepare(`
    SELECT s.*, c.name as category_name, c.slug as category_slug
    FROM stories s
    LEFT JOIN categories c ON s.category_id = c.id
    WHERE s.id = ? AND s.status = 'approved'
  `).get(req.params.id);

  if (!story) {
    return res.status(404).json({ error: 'Story not found' });
  }

  const comments = db.prepare(`
    SELECT * FROM comments 
    WHERE story_id = ? AND status = 'approved' 
    ORDER BY created_at ASC
  `).all(req.params.id);

  res.json({ story, comments });
});

// ── POST /api/stories — Submit a new story ──
app.post('/api/stories', checkBan, rateLimit('story', 5), upload.single('image'), (req, res) => {
  const db = getDb();
  const { title, body, category_id, age_confirmed } = req.body;

  if (!body || body.trim().length < 50) {
    return res.status(400).json({ error: 'Story must be at least 50 characters long.' });
  }

  if (!age_confirmed || age_confirmed !== 'true') {
    return res.status(400).json({ error: 'You must confirm you are 18 or older.' });
  }

  // Get banned keywords from settings
  let bannedKeywords = [];
  try {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'banned_keywords'").get();
    if (setting) bannedKeywords = JSON.parse(setting.value);
  } catch (e) { /* ignore */ }

  // Run moderation
  const modResult = moderateText(body, bannedKeywords);
  const titleModResult = title ? moderateText(title, bannedKeywords) : null;

  if (modResult.autoAction === 'reject' || (titleModResult && titleModResult.autoAction === 'reject')) {
    return res.status(400).json({
      error: 'Your submission contains content that violates our community guidelines.',
      flags: [...modResult.flags, ...(titleModResult?.flags || [])]
    });
  }

  // Crisis language check
  const crisisResult = detectCrisisLanguage(body);

  // Process image if uploaded
  let imageUrl = null;
  if (req.file) {
    const safetyCheck = checkImageSafety(req.file.path);
    if (!safetyCheck.safe) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Uploaded image did not pass safety checks.' });
    }
    imageUrl = `/uploads/${req.file.filename}`;
  }

  const submitterToken = uuidv4();
  const ipHash = hashIP(req.ip || req.connection.remoteAddress);

  // Determine status
  const requireApproval = db.prepare("SELECT value FROM settings WHERE key = 'require_manual_approval'").get();
  let status = 'pending';
  if (requireApproval && requireApproval.value === 'false' && modResult.autoAction === 'approve' && !crisisResult.isCrisis) {
    status = 'approved';
  }

  const result = db.prepare(`
    INSERT INTO stories (title, body, category_id, image_url, status, submitter_token, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    title ? title.trim() : null,
    modResult.redactedText,
    category_id ? parseInt(category_id) : null,
    imageUrl,
    status,
    submitterToken,
    ipHash
  );

  // Log moderation flags
  if (modResult.flags.length > 0) {
    db.prepare(
      'INSERT INTO moderation_log (target_type, target_id, action, reason) VALUES (?, ?, ?, ?)'
    ).run('story', result.lastInsertRowid, 'auto_flag', modResult.flags.join('; '));
  }

  res.status(201).json({
    id: result.lastInsertRowid,
    status,
    submitterToken,
    crisisDetected: crisisResult.isCrisis,
    crisisSeverity: crisisResult.severity,
    message: status === 'pending'
      ? 'Your story has been submitted and is awaiting review by our moderation team.'
      : 'Your story has been published.',
    important: 'Save your submitter token — it is the only way to edit or delete your story later.'
  });
});

// ── POST /api/stories/:id/comments ──
app.post('/api/stories/:id/comments', checkBan, rateLimit('comment', 15), (req, res) => {
  const db = getDb();
  const { body } = req.body;
  const storyId = parseInt(req.params.id);

  if (!body || body.trim().length < 5) {
    return res.status(400).json({ error: 'Comment must be at least 5 characters.' });
  }

  const story = db.prepare("SELECT id FROM stories WHERE id = ? AND status = 'approved'").get(storyId);
  if (!story) {
    return res.status(404).json({ error: 'Story not found.' });
  }

  let bannedKeywords = [];
  try {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'banned_keywords'").get();
    if (setting) bannedKeywords = JSON.parse(setting.value);
  } catch (e) { /* ignore */ }

  const modResult = moderateText(body, bannedKeywords);
  if (modResult.autoAction === 'reject') {
    return res.status(400).json({ error: 'Your comment contains content that violates our guidelines.' });
  }

  const ipHash = hashIP(req.ip || req.connection.remoteAddress);
  const requireApproval = db.prepare("SELECT value FROM settings WHERE key = 'require_manual_approval'").get();
  let status = 'pending';
  if (requireApproval && requireApproval.value === 'false' && modResult.autoAction === 'approve') {
    status = 'approved';
  }

  const result = db.prepare(
    'INSERT INTO comments (story_id, body, status, ip_hash) VALUES (?, ?, ?, ?)'
  ).run(storyId, modResult.redactedText, status, ipHash);

  if (status === 'approved') {
    db.prepare('UPDATE stories SET comment_count = comment_count + 1 WHERE id = ?').run(storyId);
  }

  res.status(201).json({
    id: result.lastInsertRowid,
    status,
    message: status === 'pending'
      ? 'Your comment is awaiting moderation.'
      : 'Comment posted.'
  });
});

// ── POST /api/stories/:id/like ──
app.post('/api/stories/:id/like', checkBan, rateLimit('like', 60), (req, res) => {
  const db = getDb();
  const storyId = parseInt(req.params.id);
  const ipHash = hashIP(req.ip || req.connection.remoteAddress);

  const story = db.prepare("SELECT id FROM stories WHERE id = ? AND status = 'approved'").get(storyId);
  if (!story) {
    return res.status(404).json({ error: 'Story not found.' });
  }

  const existingLike = db.prepare(
    'SELECT id FROM likes WHERE story_id = ? AND ip_hash = ?'
  ).get(storyId, ipHash);

  if (existingLike) {
    // Unlike
    db.prepare('DELETE FROM likes WHERE id = ?').run(existingLike.id);
    db.prepare('UPDATE stories SET like_count = MAX(0, like_count - 1) WHERE id = ?').run(storyId);
    const updated = db.prepare('SELECT like_count FROM stories WHERE id = ?').get(storyId);
    return res.json({ liked: false, like_count: updated.like_count });
  }

  // Like
  db.prepare('INSERT INTO likes (story_id, ip_hash) VALUES (?, ?)').run(storyId, ipHash);
  db.prepare('UPDATE stories SET like_count = like_count + 1 WHERE id = ?').run(storyId);
  const updated = db.prepare('SELECT like_count FROM stories WHERE id = ?').get(storyId);
  res.json({ liked: true, like_count: updated.like_count });
});

// ── POST /api/reports ──
app.post('/api/reports', checkBan, rateLimit('report', 10), (req, res) => {
  const db = getDb();
  const { target_type, target_id, reason } = req.body;

  if (!['story', 'comment'].includes(target_type)) {
    return res.status(400).json({ error: 'Invalid target type.' });
  }
  if (!target_id || !reason) {
    return res.status(400).json({ error: 'Target ID and reason are required.' });
  }

  const ipHash = hashIP(req.ip || req.connection.remoteAddress);

  db.prepare(
    'INSERT INTO reports (target_type, target_id, reason, reporter_ip_hash) VALUES (?, ?, ?, ?)'
  ).run(target_type, parseInt(target_id), reason, ipHash);

  // Auto-hide if report threshold exceeded
  const threshold = db.prepare("SELECT value FROM settings WHERE key = 'auto_hide_report_threshold'").get();
  const thresholdVal = threshold ? parseInt(threshold.value) : 3;
  const reportCount = db.prepare(
    'SELECT COUNT(*) as count FROM reports WHERE target_type = ? AND target_id = ? AND resolved = 0'
  ).get(target_type, parseInt(target_id)).count;

  if (reportCount >= thresholdVal) {
    const table = target_type === 'story' ? 'stories' : 'comments';
    db.prepare(`UPDATE ${table} SET status = 'pending' WHERE id = ? AND status = 'approved'`).run(parseInt(target_id));
  }

  res.json({ message: 'Report submitted. Thank you for helping keep our community safe.' });
});

// ── POST /api/moderate/text — Live PII/crisis check (for frontend) ──
app.post('/api/moderate/text', (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ pii: [], crisis: { isCrisis: false } });

  const pii = detectPII(text);
  const crisis = detectCrisisLanguage(text);
  res.json({ pii, crisis });
});

// ── GET /api/crisis-resources ──
app.get('/api/crisis-resources', (req, res) => {
  res.json({
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

// ── POST /api/admin/login ──
app.post('/api/admin/login', rateLimit('admin-login', 10), (req, res) => {
  const db = getDb();
  const { username, password } = req.body;

  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  if (admin.mfa_enabled) {
    // Return a temporary pre-auth token for MFA step
    const preToken = crypto.randomBytes(16).toString('hex');
    adminSessions.set(`pre:${preToken}`, { adminId: admin.id, username: admin.username, step: 'mfa' });
    setTimeout(() => adminSessions.delete(`pre:${preToken}`), 5 * 60 * 1000); // 5 min expiry
    return res.json({ requireMFA: true, preToken });
  }

  const token = generateAdminToken();
  adminSessions.set(token, { adminId: admin.id, username: admin.username, role: admin.role });
  setTimeout(() => adminSessions.delete(token), 8 * 60 * 60 * 1000); // 8 hour session
  res.json({ token, username: admin.username, role: admin.role, mfaEnabled: false });
});

// ── POST /api/admin/mfa-verify ──
app.post('/api/admin/mfa-verify', (req, res) => {
  const db = getDb();
  const { preToken, code } = req.body;

  const preSession = adminSessions.get(`pre:${preToken}`);
  if (!preSession || preSession.step !== 'mfa') {
    return res.status(401).json({ error: 'Invalid or expired pre-auth token.' });
  }

  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(preSession.adminId);
  const isValid = authenticator.verify({ token: code, secret: admin.mfa_secret });

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid MFA code.' });
  }

  adminSessions.delete(`pre:${preToken}`);
  const token = generateAdminToken();
  adminSessions.set(token, { adminId: admin.id, username: admin.username, role: admin.role });
  setTimeout(() => adminSessions.delete(token), 8 * 60 * 60 * 1000);
  res.json({ token, username: admin.username, role: admin.role });
});

// ── POST /api/admin/mfa-setup ──
app.post('/api/admin/mfa-setup', requireAdmin, async (req, res) => {
  const db = getDb();
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.admin.adminId);
  const secret = admin.mfa_secret || authenticator.generateSecret();

  if (!admin.mfa_secret) {
    db.prepare('UPDATE admin_users SET mfa_secret = ? WHERE id = ?').run(secret, admin.id);
  }

  const otpauth = authenticator.keyuri(admin.email, 'LifeStories Admin', secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  res.json({ secret, qrCode: qrDataUrl, email: admin.email });
});

// ── POST /api/admin/mfa-enable ──
app.post('/api/admin/mfa-enable', requireAdmin, (req, res) => {
  const db = getDb();
  const { code } = req.body;
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.admin.adminId);

  const isValid = authenticator.verify({ token: code, secret: admin.mfa_secret });
  if (!isValid) {
    return res.status(400).json({ error: 'Invalid code. Please try again.' });
  }

  db.prepare('UPDATE admin_users SET mfa_enabled = 1 WHERE id = ?').run(admin.id);
  res.json({ message: 'MFA enabled successfully.' });
});

// ── GET /api/admin/stats ──
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const db = getDb();
  const totalStories = db.prepare('SELECT COUNT(*) as c FROM stories').get().c;
  const pendingStories = db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'pending'").get().c;
  const approvedStories = db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'approved'").get().c;
  const rejectedStories = db.prepare("SELECT COUNT(*) as c FROM stories WHERE status = 'rejected'").get().c;
  const totalComments = db.prepare('SELECT COUNT(*) as c FROM comments').get().c;
  const pendingComments = db.prepare("SELECT COUNT(*) as c FROM comments WHERE status = 'pending'").get().c;
  const openReports = db.prepare('SELECT COUNT(*) as c FROM reports WHERE resolved = 0').get().c;
  const totalLikes = db.prepare('SELECT COALESCE(SUM(like_count), 0) as c FROM stories').get().c;
  const bannedIPs = db.prepare('SELECT COUNT(*) as c FROM banned_identifiers').get().c;

  // Stories per day (last 7 days)
  const dailyStories = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM stories
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all();

  res.json({
    totalStories, pendingStories, approvedStories, rejectedStories,
    totalComments, pendingComments, openReports, totalLikes, bannedIPs,
    dailyStories
  });
});

// ── GET /api/admin/queue ──
app.get('/api/admin/queue', requireAdmin, (req, res) => {
  const db = getDb();
  const { type = 'stories', status = 'pending' } = req.query;

  if (type === 'stories') {
    const items = db.prepare(`
      SELECT s.*, c.name as category_name
      FROM stories s
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.status = ?
      ORDER BY s.created_at ASC
    `).all(status);
    res.json({ items, type: 'stories' });
  } else {
    const items = db.prepare(`
      SELECT cm.*, s.title as story_title
      FROM comments cm
      LEFT JOIN stories s ON cm.story_id = s.id
      WHERE cm.status = ?
      ORDER BY cm.created_at ASC
    `).all(status);
    res.json({ items, type: 'comments' });
  }
});

// ── POST /api/admin/moderate ──
app.post('/api/admin/moderate', requireAdmin, (req, res) => {
  const db = getDb();
  const { target_type, target_id, action, reason } = req.body;

  if (!['approve', 'reject', 'remove'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action.' });
  }

  const statusMap = { approve: 'approved', reject: 'rejected', remove: 'removed' };
  const table = target_type === 'story' ? 'stories' : 'comments';

  db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).run(statusMap[action], parseInt(target_id));

  // Update comment count if approving/rejecting a comment
  if (target_type === 'comment') {
    const comment = db.prepare('SELECT story_id FROM comments WHERE id = ?').get(parseInt(target_id));
    if (comment) {
      const count = db.prepare("SELECT COUNT(*) as c FROM comments WHERE story_id = ? AND status = 'approved'").get(comment.story_id).c;
      db.prepare('UPDATE stories SET comment_count = ? WHERE id = ?').run(count, comment.story_id);
    }
  }

  // Log the action
  db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).run(target_type, parseInt(target_id), req.admin.adminId, action, reason || null);

  res.json({ message: `Content ${statusMap[action]} successfully.` });
});

// ── GET /api/admin/reports ──
app.get('/api/admin/reports', requireAdmin, (req, res) => {
  const db = getDb();
  const { resolved = '0' } = req.query;

  const reports = db.prepare(`
    SELECT r.*, 
      CASE r.target_type 
        WHEN 'story' THEN (SELECT title FROM stories WHERE id = r.target_id)
        WHEN 'comment' THEN (SELECT substr(body, 1, 100) FROM comments WHERE id = r.target_id)
      END as target_preview
    FROM reports r
    WHERE r.resolved = ?
    ORDER BY r.created_at DESC
  `).all(parseInt(resolved));

  res.json(reports);
});

// ── POST /api/admin/reports/:id/resolve ──
app.post('/api/admin/reports/:id/resolve', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?').run(parseInt(req.params.id));

  db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).run('report', parseInt(req.params.id), req.admin.adminId, 'resolve_report', req.body.reason || null);

  res.json({ message: 'Report resolved.' });
});

// ── POST /api/admin/ban ──
app.post('/api/admin/ban', requireAdmin, (req, res) => {
  const db = getDb();
  const { identifier, reason, duration_hours } = req.body;

  const expiresAt = duration_hours
    ? new Date(Date.now() + parseInt(duration_hours) * 60 * 60 * 1000).toISOString()
    : null;

  db.prepare(
    'INSERT INTO banned_identifiers (identifier, type, reason, expires_at) VALUES (?, ?, ?, ?)'
  ).run(identifier, 'ip', reason || 'Policy violation', expiresAt);

  db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).run('ban', 0, req.admin.adminId, 'ban_ip', `Banned: ${identifier} - ${reason || 'Policy violation'}`);

  res.json({ message: 'IP banned successfully.' });
});

// ── GET /api/admin/bans ──
app.get('/api/admin/bans', requireAdmin, (req, res) => {
  const db = getDb();
  const bans = db.prepare('SELECT * FROM banned_identifiers ORDER BY created_at DESC').all();
  res.json(bans);
});

// ── DELETE /api/admin/bans/:id ──
app.delete('/api/admin/bans/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM banned_identifiers WHERE id = ?').run(parseInt(req.params.id));
  res.json({ message: 'Ban removed.' });
});

// ── GET /api/admin/audit-log ──
app.get('/api/admin/audit-log', requireAdmin, (req, res) => {
  const db = getDb();
  const logs = db.prepare(`
    SELECT ml.*, au.username as admin_username
    FROM moderation_log ml
    LEFT JOIN admin_users au ON ml.admin_id = au.id
    ORDER BY ml.created_at DESC
    LIMIT 100
  `).all();
  res.json(logs);
});

// ── GET /api/admin/settings ──
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM settings').all();
  const result = {};
  for (const s of settings) {
    try { result[s.key] = JSON.parse(s.value); } catch { result[s.key] = s.value; }
  }
  res.json(result);
});

// ── PUT /api/admin/settings ──
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const db = getDb();
  const updates = req.body;

  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
  for (const [key, value] of Object.entries(updates)) {
    const val = typeof value === 'object' ? JSON.stringify(value) : String(value);
    upsert.run(key, val, val);
  }

  db.prepare(
    'INSERT INTO moderation_log (target_type, target_id, admin_id, action, reason) VALUES (?, ?, ?, ?, ?)'
  ).run('settings', 0, req.admin.adminId, 'update_settings', `Updated keys: ${Object.keys(updates).join(', ')}`);

  res.json({ message: 'Settings updated.' });
});

// ── GET /api/admin/categories ──
app.get('/api/admin/categories', requireAdmin, (req, res) => {
  const db = getDb();
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM stories WHERE category_id = c.id) as story_count
    FROM categories c ORDER BY c.name
  `).all();
  res.json(categories);
});

// ── POST /api/admin/categories ──
app.post('/api/admin/categories', requireAdmin, (req, res) => {
  const db = getDb();
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try {
    db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name, slug);
    res.json({ message: 'Category created.' });
  } catch (e) {
    res.status(400).json({ error: 'Category already exists.' });
  }
});

// ── DELETE /api/admin/categories/:id ──
app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE stories SET category_id = NULL WHERE category_id = ?').run(parseInt(req.params.id));
  db.prepare('DELETE FROM categories WHERE id = ?').run(parseInt(req.params.id));
  res.json({ message: 'Category deleted.' });
});

// ── Fallback: serve index.html for SPA-like navigation ──
app.get('*', (req, res) => {
  // Only serve HTML pages for known routes
  const knownPages = ['submit', 'story', 'resources', 'about', 'terms', 'privacy', 'guidelines', 'admin'];
  const requestedPage = req.path.split('/').filter(Boolean)[0];

  if (knownPages.includes(requestedPage)) {
    const htmlFile = path.join(__dirname, 'public', `${requestedPage}.html`);
    if (fs.existsSync(htmlFile)) {
      return res.sendFile(htmlFile);
    }
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handling ──
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size must be under 5MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  console.error('Server error:', err);
  res.status(500).json({ error: 'An internal server error occurred.' });
});

// ── Start Server ──
initializeDatabase();

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🌟 Anonymous Life Stories Platform`);
    console.log(`   Running at http://localhost:${PORT}`);
    console.log(`   Admin panel at http://localhost:${PORT}/admin\n`);
  });
}

module.exports = app;
