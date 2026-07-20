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

const JWT_SECRET = 'midnight_stories_user_secret_2026';

// Custom JWT verify for Express
async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [header, payload, signature] = parts;
  const data = `${header}.${payload}`;
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  const expectedSignature = hmac.digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    
  if (signature !== expectedSignature) {
    throw new Error('Invalid token signature');
  }
  
  const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return decoded;
}

async function requireUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  try {
    req.user = await verifyJWT(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }
}

async function optionalUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      req.user = await verifyJWT(token, JWT_SECRET);
    } catch (err) {}
  }
  next();
}

async function requireAdminOrUser(req, res, next) {
  const adminToken = req.headers['x-admin-token'];
  if (adminToken && adminSessions.has(adminToken)) {
    req.admin = adminSessions.get(adminToken);
    req.role = 'admin';
    return next();
  }
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      req.user = await verifyJWT(token, JWT_SECRET);
      req.role = 'user';
      return next();
    } catch (err) {}
  }
  
  return res.status(401).json({ error: 'Unauthorized. Please log in.' });
}

const uploadBook = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.epub', '.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only EPUB, PDF, and image covers are allowed.'));
    }
  }
});

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

// ── GET /api/categories ──
app.get('/api/categories', (req, res) => {
  const db = getDb();
  const { channel } = req.query;
  let sql = 'SELECT * FROM categories';
  const params = [];
  if (channel) {
    sql += ' WHERE channel_type = ?';
    params.push(channel);
  }
  sql += ' ORDER BY name';
  const categories = db.prepare(sql).all(...params);
  res.json(categories);
});

// ── POST /api/admin/categories ──
app.post('/api/admin/categories', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, channel_type = 'education' } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (channel_type !== 'education' && channel_type !== 'naval') {
    return res.status(400).json({ error: 'Invalid channel type.' });
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  try {
    db.prepare('INSERT INTO categories (name, slug, channel_type) VALUES (?, ?, ?)').run(name, slug, channel_type);
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

// ═════════════════════════════════════════════════════════
// ██  BOOK LIBRARY & READER MODE ROUTES (Additive)
// ═════════════════════════════════════════════════════════

// ── POST /api/admin/books ──
app.post('/api/admin/books', requireAdminOrUser, uploadBook.fields([{ name: 'book', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  const db = getDb();
  
  if (!req.files || !req.files['book']) {
    return res.status(400).json({ error: 'Book file is required.' });
  }

  const bookFile = req.files['book'][0];
  const coverFile = req.files['cover'] ? req.files['cover'][0] : null;

  const fileType = bookFile.originalname.endsWith('.pdf') ? 'pdf' : 'epub';
  const fileUrl = `/uploads/${bookFile.filename}`;
  const coverImageUrl = coverFile ? `/uploads/${coverFile.filename}` : '/images/default-cover.png';

  const {
    title, author, description, publisher, language = 'en', isbn,
    published_date, page_count, est_read_minutes, visibility = 'public',
    status: reqStatus = 'draft'
  } = req.body;

  if (!title || !author) {
    return res.status(400).json({ error: 'Title and author are required.' });
  }

  let finalStatus = reqStatus;
  let uploadedBy = null;
  let approvedBy = null;

  if (req.role === 'admin') {
    approvedBy = req.admin.adminId;
  } else {
    uploadedBy = req.user.id;
    finalStatus = 'pending';
  }

  let categoryIds = [];
  if (req.body.category_ids) {
    try {
      categoryIds = JSON.parse(req.body.category_ids);
    } catch (e) {
      if (typeof req.body.category_ids === 'string') {
        categoryIds = req.body.category_ids.split(',').map(id => id.trim());
      } else if (Array.isArray(req.body.category_ids)) {
        categoryIds = req.body.category_ids;
      }
    }
  }

  let tagsList = [];
  if (req.body.tags) {
    try {
      tagsList = JSON.parse(req.body.tags);
    } catch (e) {
      if (typeof req.body.tags === 'string') {
        tagsList = req.body.tags.split(',').map(t => t.trim());
      } else if (Array.isArray(req.body.tags)) {
        tagsList = req.body.tags;
      }
    }
  }

  try {
    const bookId = insertBookTx({
      title, author, description, publisher, language, isbn,
      published_date, page_count: page_count ? parseInt(page_count) : null,
      est_read_minutes: est_read_minutes ? parseInt(est_read_minutes) : null,
      cover_image_url: coverImageUrl, file_url: fileUrl, file_type: fileType,
      status: finalStatus, visibility, uploaded_by: uploadedBy, approved_by: approvedBy,
      channel_type: req.body.channel_type || 'education'
    }, categoryIds, tagsList);

    res.status(201).json({
      success: true,
      bookId,
      message: finalStatus === 'pending'
        ? 'Book uploaded successfully and is awaiting moderation.'
        : 'Book published successfully.'
    });
  } catch (err) {
    console.error('Error saving book:', err);
    res.status(500).json({ error: 'Failed to save book to database.' });
  }
});

// Helper transaction executor definition
const insertBookTx = (bookData, categoryIds, tagsList) => {
  const db = getDb();
  let bookId;
  
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO books (title, author, description, publisher, language, isbn, published_date, page_count, est_read_minutes, cover_image_url, file_url, file_type, status, visibility, uploaded_by, approved_by, channel_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bookData.title, bookData.author, bookData.description, bookData.publisher, bookData.language, bookData.isbn,
      bookData.published_date, bookData.page_count, bookData.est_read_minutes, bookData.cover_image_url, bookData.file_url,
      bookData.file_type, bookData.status, bookData.visibility, bookData.uploaded_by, bookData.approved_by, bookData.channel_type || 'education'
    );
    
    bookId = info.lastInsertRowid;
    
    const insertCat = db.prepare('INSERT OR IGNORE INTO book_categories (book_id, category_id) VALUES (?, ?)');
    for (const catId of categoryIds) {
      if (catId) insertCat.run(bookId, parseInt(catId));
    }
    
    const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)');
    const getTag = db.prepare('SELECT id FROM tags WHERE slug = ?');
    const insertBookTag = db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)');
    
    for (const t of tagsList) {
      if (t) {
        const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        insertTag.run(t, slug);
        const tag = getTag.get(slug);
        if (tag) {
          insertBookTag.run(bookId, tag.id);
        }
      }
    }
  });

  tx();
  return bookId;
};

// ── PUT /api/admin/books/:id ──
app.put('/api/admin/books/:id', requireAdminOrUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);
  
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found.' });

  if (req.role !== 'admin' && book.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized to edit this book.' });
  }

  const {
    title, author, description, publisher, language, isbn,
    published_date, page_count, est_read_minutes, visibility, status
  } = req.body;

  let finalStatus = status || book.status;
  if (req.role !== 'admin') {
    finalStatus = 'pending';
  }

  db.prepare(`
    UPDATE books
    SET title = ?, author = ?, description = ?, publisher = ?, language = ?, isbn = ?,
        published_date = ?, page_count = ?, est_read_minutes = ?, visibility = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title || book.title, author || book.author, description || book.description,
    publisher || book.publisher, language || book.language, isbn || book.isbn,
    published_date || book.published_date, page_count ? parseInt(page_count) : book.page_count,
    est_read_minutes ? parseInt(est_read_minutes) : book.est_read_minutes,
    visibility || book.visibility, finalStatus, bookId
  );

  if (req.body.category_ids) {
    let categoryIds = [];
    try {
      categoryIds = typeof req.body.category_ids === 'string' ? JSON.parse(req.body.category_ids) : req.body.category_ids;
    } catch (e) {
      categoryIds = req.body.category_ids.split(',').map(id => id.trim());
    }
    
    db.prepare('DELETE FROM book_categories WHERE book_id = ?').run(bookId);
    const insertCat = db.prepare('INSERT OR IGNORE INTO book_categories (book_id, category_id) VALUES (?, ?)');
    for (const catId of categoryIds) {
      if (catId) insertCat.run(bookId, parseInt(catId));
    }
  }

  if (req.body.tags) {
    let tagsList = [];
    try {
      tagsList = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
    } catch (e) {
      tagsList = req.body.tags.split(',').map(t => t.trim());
    }

    db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId);
    const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)');
    const getTag = db.prepare('SELECT id FROM tags WHERE slug = ?');
    const insertBookTag = db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)');
    
    for (const t of tagsList) {
      if (t) {
        const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        insertTag.run(t, slug);
        const tag = getTag.get(slug);
        if (tag) insertBookTag.run(bookId, tag.id);
      }
    }
  }

  res.json({ success: true, message: 'Book metadata updated successfully.' });
});

// ── DELETE /api/admin/books/:id ──
app.delete('/api/admin/books/:id', requireAdminOrUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found.' });

  if (req.role !== 'admin' && book.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized to delete this book.' });
  }

  db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
  res.json({ success: true, message: 'Book deleted successfully.' });
});

// ── GET /api/admin/books/pending ──
app.get('/api/admin/books/pending', requireAdmin, (req, res) => {
  const db = getDb();
  const books = db.prepare(`
    SELECT b.*, u.full_name as uploader_name
    FROM books b
    LEFT JOIN users u ON b.uploaded_by = u.id
    WHERE b.status = 'pending'
    ORDER BY b.created_at ASC
  `).all();
  res.json(books);
});

// ── POST /api/admin/books/:id/approve ──
app.post('/api/admin/books/:id/approve', requireAdmin, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);

  const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found.' });

  db.prepare('UPDATE books SET status = "published", approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(req.admin.adminId, bookId);

  res.json({ success: true, message: 'Book approved and published.' });
});

// ── GET /api/books ──
app.get('/api/books', optionalUser, (req, res) => {
  const db = getDb();
  const { sort = 'newest', category, search, page = 1, limit = 12, shelf, channel } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = "WHERE b.status = 'published'";
  const params = [];

  if (channel) {
    where += " AND b.channel_type = ?";
    params.push(channel);
  }

  if (!req.user) {
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

  if (shelf && req.user) {
    where += ' AND b.id IN (SELECT book_id FROM user_library WHERE user_id = ? AND shelf_status = ?)';
    params.push(req.user.id, shelf);
  }

  let orderBy;
  switch (sort) {
    case 'title': orderBy = 'b.title ASC'; break;
    case 'popular': orderBy = 'b.id DESC'; break;
    default: orderBy = 'b.created_at DESC';
  }

  const total = db.prepare(`SELECT COUNT(*) as total FROM books b ${where}`).get(...params).total;

  const sql = `
    SELECT b.*,
      (SELECT GROUP_CONCAT(c.name) FROM book_categories bc JOIN categories c ON bc.category_id = c.id WHERE bc.book_id = b.id) as category_names,
      (SELECT GROUP_CONCAT(t.name) FROM book_tags bt JOIN tags t ON bt.tag_id = t.id WHERE bt.book_id = b.id) as tag_names
    FROM books b
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const books = db.prepare(sql).all(...params, parseInt(limit), offset);

  if (req.user && books.length > 0) {
    const bookIds = books.map(b => b.id);
    const placeholders = bookIds.map(() => '?').join(',');
    
    const progressRows = db.prepare(`
      SELECT book_id, percent_complete, location_cfi
      FROM reading_progress
      WHERE user_id = ? AND book_id IN (${placeholders})
    `).all(req.user.id, ...bookIds);
    
    const shelfRows = db.prepare(`
      SELECT book_id, shelf_status
      FROM user_library
      WHERE user_id = ? AND book_id IN (${placeholders})
    `).all(req.user.id, ...bookIds);
    
    const progressMap = new Map(progressRows.map(p => [p.book_id, p]));
    const shelfMap = new Map(shelfRows.map(s => [s.book_id, s.shelf_status]));
    
    books.forEach(b => {
      b.progress = progressMap.get(b.id) || null;
      b.shelf_status = shelfMap.get(b.id) || null;
    });
  }

  res.json({
    books,
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit))
  });
});

// ── GET /api/books/:id ──
app.get('/api/books/:id', optionalUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);

  const book = db.prepare(`
    SELECT b.*,
      (SELECT GROUP_CONCAT(c.name) FROM book_categories bc JOIN categories c ON bc.category_id = c.id WHERE bc.book_id = b.id) as category_names,
      (SELECT GROUP_CONCAT(c.id) FROM book_categories bc WHERE bc.book_id = b.id) as category_ids,
      (SELECT GROUP_CONCAT(t.name) FROM book_tags bt JOIN tags t ON bt.tag_id = t.id WHERE bt.book_id = b.id) as tag_names
    FROM books b
    WHERE b.id = ?
  `).get(bookId);

  if (!book) return res.status(404).json({ error: 'Book not found.' });
  if (book.status !== 'published' && (!req.user || book.uploaded_by !== req.user.id) && !req.admin) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  if (req.user) {
    book.progress = db.prepare('SELECT percent_complete, location_cfi FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user.id, bookId) || null;
    book.shelf_status = (db.prepare('SELECT shelf_status FROM user_library WHERE user_id = ? AND book_id = ?').get(req.user.id, bookId) || {}).shelf_status || null;
  }

  res.json(book);
});

// ── GET /api/books/:id/file ──
app.get('/api/books/:id/file', optionalUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);

  const book = db.prepare('SELECT file_url, status, visibility, uploaded_by FROM books WHERE id = ?').get(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found.' });

  if (book.status !== 'published' && (!req.user || book.uploaded_by !== req.user.id) && !req.admin) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  if (book.visibility === 'restricted' && !req.user && !req.admin) {
    return res.status(401).json({ error: 'Authentication required to read this book.' });
  }

  const filePath = path.join(__dirname, 'public', book.file_url);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk.' });
  }

  res.sendFile(filePath);
});

// ── GET /api/books/:id/progress ──
app.get('/api/books/:id/progress', requireUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);
  const progress = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user.id, bookId);
  res.json(progress || { location_cfi: null, percent_complete: 0 });
});

// ── POST /api/books/:id/progress ──
app.post('/api/books/:id/progress', requireUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);
  const { location_cfi, percent_complete } = req.body;

  db.prepare(`
    INSERT INTO reading_progress (user_id, book_id, location_cfi, percent_complete, last_read_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, book_id) DO UPDATE SET
      location_cfi = ?, percent_complete = ?, last_read_at = CURRENT_TIMESTAMP
  `).run(req.user.id, bookId, location_cfi, percent_complete, location_cfi, percent_complete);

  const shelf = db.prepare('SELECT shelf_status FROM user_library WHERE user_id = ? AND book_id = ?').get(req.user.id, bookId);
  if (!shelf) {
    db.prepare('INSERT INTO user_library (user_id, book_id, shelf_status) VALUES (?, ?, "currently_reading")').run(req.user.id, bookId);
  } else if (shelf.shelf_status === 'want_to_read') {
    db.prepare('UPDATE user_library SET shelf_status = "currently_reading" WHERE user_id = ? AND book_id = ?').run(req.user.id, bookId);
  }

  res.json({ success: true });
});

// ── GET /api/books/:id/bookmarks ──
app.get('/api/books/:id/bookmarks', requireUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);
  const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC').all(req.user.id, bookId);
  res.json(bookmarks);
});

// ── POST /api/books/:id/bookmarks ──
app.post('/api/books/:id/bookmarks', requireUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);
  const { location_cfi, label } = req.body;

  if (!location_cfi) return res.status(400).json({ error: 'Location CFI is required.' });

  const result = db.prepare('INSERT INTO bookmarks (user_id, book_id, location_cfi, label) VALUES (?, ?, ?, ?)')
    .run(req.user.id, bookId, location_cfi, label || `Bookmark at ${new Date().toLocaleDateString()}`);

  res.status(201).json({ success: true, bookmarkId: result.lastInsertRowid });
});

// ── DELETE /api/books/:id/bookmarks/:bookmarkId ──
app.delete('/api/books/:id/bookmarks/:bookmarkId', requireUser, (req, res) => {
  const db = getDb();
  const bookmarkId = parseInt(req.params.bookmarkId);
  const bookId = parseInt(req.params.id);
  
  db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ? AND book_id = ?').run(bookmarkId, req.user.id, bookId);
  res.json({ success: true });
});

// ── GET /api/books/:id/highlights ──
app.get('/api/books/:id/highlights', requireUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);
  const highlights = db.prepare('SELECT * FROM highlights WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC').all(req.user.id, bookId);
  res.json(highlights);
});

// ── POST /api/books/:id/highlights ──
app.post('/api/books/:id/highlights', requireUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);
  const { location_cfi_start, location_cfi_end, color = 'yellow', note_text } = req.body;

  if (!location_cfi_start || !location_cfi_end) {
    return res.status(400).json({ error: 'Start and end CFIs are required.' });
  }

  const result = db.prepare('INSERT INTO highlights (user_id, book_id, location_cfi_start, location_cfi_end, color, note_text) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, bookId, location_cfi_start, location_cfi_end, color, note_text || null);

  res.status(201).json({ success: true, highlightId: result.lastInsertRowid });
});

// ── DELETE /api/books/:id/highlights/:highlightId ──
app.delete('/api/books/:id/highlights/:highlightId', requireUser, (req, res) => {
  const db = getDb();
  const highlightId = parseInt(req.params.highlightId);
  const bookId = parseInt(req.params.id);

  db.prepare('DELETE FROM highlights WHERE id = ? AND user_id = ? AND book_id = ?').run(highlightId, req.user.id, bookId);
  res.json({ success: true });
});

// ── POST /api/books/:id/shelf ──
app.post('/api/books/:id/shelf', requireUser, (req, res) => {
  const db = getDb();
  const bookId = parseInt(req.params.id);
  const { shelf_status } = req.body;

  if (shelf_status === null) {
    db.prepare('DELETE FROM user_library WHERE user_id = ? AND book_id = ?').run(req.user.id, bookId);
    return res.json({ success: true, message: 'Removed from shelf.' });
  }

  if (!['want_to_read', 'currently_reading', 'finished'].includes(shelf_status)) {
    return res.status(400).json({ error: 'Invalid shelf status.' });
  }

  db.prepare(`
    INSERT INTO user_library (user_id, book_id, shelf_status)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, book_id) DO UPDATE SET shelf_status = ?
  `).run(req.user.id, bookId, shelf_status, shelf_status);

  res.json({ success: true, message: `Added to ${shelf_status} shelf.` });
});

// ── POST /api/user/books/upload ──
app.post('/api/user/books/upload', requireUser, uploadBook.fields([{ name: 'book', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
  const db = getDb();
  
  if (!req.files || !req.files['book']) {
    return res.status(400).json({ error: 'Book file is required.' });
  }

  const bookFile = req.files['book'][0];
  const coverFile = req.files['cover'] ? req.files['cover'][0] : null;

  const fileUrl = `/uploads/${bookFile.filename}`;
  const coverImageUrl = coverFile ? `/uploads/${coverFile.filename}` : '/images/default-cover.png';

  const { title, author, channel_type, category_id, description } = req.body;

  if (!title || !author || !channel_type || !category_id) {
    return res.status(400).json({ error: 'Title, author, channel type, and category ID are required.' });
  }

  if (channel_type !== 'education' && channel_type !== 'naval') {
    return res.status(400).json({ error: 'Invalid channel type.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO user_book_submissions (user_id, title, author, channel_type, category_id, description, cover_image_url, book_file_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      req.user.id,
      title,
      author,
      channel_type,
      parseInt(category_id),
      description || null,
      coverImageUrl,
      fileUrl
    );

    res.status(201).json({
      success: true,
      submissionId: result.lastInsertRowid,
      message: 'Your book submission has been received successfully and is pending administrative review.'
    });
  } catch (err) {
    console.error('Error saving user submission:', err);
    res.status(500).json({ error: 'Failed to save submission.' });
  }
});

// ── GET /api/admin/submissions ──
app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  const db = getDb();
  try {
    const submissions = db.prepare(`
      SELECT s.*, u.full_name as uploader_name, u.email as uploader_email, c.name as category_name
      FROM user_book_submissions s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.status = 'pending'
      ORDER BY s.created_at ASC
    `).all();
    res.json(submissions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch submissions.' });
  }
});

// ── POST /api/admin/submissions/:id/approve ──
app.post('/api/admin/submissions/:id/approve', requireAdmin, (req, res) => {
  const db = getDb();
  const submissionId = parseInt(req.params.id);

  const sub = db.prepare('SELECT * FROM user_book_submissions WHERE id = ?').get(submissionId);
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });

  const tx = db.transaction(() => {
    // 1. Insert into books
    const bookRes = db.prepare(`
      INSERT INTO books (title, author, description, cover_image_url, file_url, file_type, status, visibility, uploaded_by_user_id, is_user_submission, submission_status, channel_type, approved_by)
      VALUES (?, ?, ?, ?, ?, ?, 'published', 'public', ?, 1, 'approved', ?, ?)
    `).run(
      sub.title,
      sub.author,
      sub.description,
      sub.cover_image_url,
      sub.book_file_url,
      sub.book_file_url.endsWith('.pdf') ? 'pdf' : 'epub',
      sub.user_id,
      sub.channel_type,
      req.admin.adminId
    );

    const bookId = bookRes.lastInsertRowid;

    // 2. Link category
    db.prepare(`
      INSERT OR IGNORE INTO book_categories (book_id, category_id)
      VALUES (?, ?)
    `).run(bookId, sub.category_id);

    // 3. Mark submission as approved
    db.prepare('UPDATE user_book_submissions SET status = "approved" WHERE id = ?').run(submissionId);
    
    // 4. Send notification to the user
    db.prepare(`
      INSERT INTO notifications (user_id, type, source_id, read)
      VALUES (?, 'book_approved', ?, 0)
    `).run(sub.user_id, bookId);
  });

  try {
    tx();
    res.json({ success: true, message: 'Submission approved and published.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Approval transaction failed.' });
  }
});

// ── POST /api/admin/submissions/:id/reject ──
app.post('/api/admin/submissions/:id/reject', requireAdmin, (req, res) => {
  const db = getDb();
  const submissionId = parseInt(req.params.id);
  const { rejection_reason } = req.body;

  const sub = db.prepare('SELECT * FROM user_book_submissions WHERE id = ?').get(submissionId);
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });

  db.prepare('UPDATE user_book_submissions SET status = "rejected", rejection_reason = ? WHERE id = ?')
    .run(rejection_reason || null, submissionId);

  // Send notification to the user
  db.prepare(`
    INSERT INTO notifications (user_id, type, source_id, read)
    VALUES (?, 'book_rejected', ?, 0)
  `).run(sub.user_id, submissionId);

  res.json({ success: true, message: 'Submission rejected.' });
});

// ── Fallback: serve index.html for SPA-like navigation ──
app.get('*', (req, res) => {
  // Only serve HTML pages for known routes
  const knownPages = ['submit', 'story', 'resources', 'about', 'terms', 'privacy', 'guidelines', 'admin', 'library', 'reader', 'upload-book'];
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
