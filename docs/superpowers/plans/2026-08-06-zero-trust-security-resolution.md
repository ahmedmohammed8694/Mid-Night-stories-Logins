# Zero-Trust Security Remediation Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate security audit flaws identified in the Zero-Trust security checklist for Midnight Stories.

**Architecture:**
1. Secure JWT secrets across Node.js/Express and Worker backends.
2. Remove OTP exfiltration logs.
3. Transition hardcoded/disallowed role checks to positive capability checks.
4. Verify file signatures (magic bytes) for all uploads.
5. Filter raw user query objects via a dedicated response DTO.
6. Validate pagination parameters and sanitise error responses.

**Tech Stack:** Node.js, Express, Hono, SQLite, Cloudflare Workers, Multer.

## Global Constraints
- Confine all file changes inside the workspace directory.
- Preserve backward compatibility for all routing parameters.

---

### Task 1: Secure JWT Secrets

**Files:**
- Modify: [src/worker.js](file:///d:/My%20Applications/Midnigth%20stories/src/worker.js)
- Modify: [server.js](file:///d:/My%20Applications/Midnigth%20stories/server.js)

- [ ] **Step 1: Update src/worker.js JWT secret helpers**
  Modify lines 1028-1029 in `src/worker.js` to throw configuration exceptions if environment secret keys are missing:
  ```javascript
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
  ```

- [ ] **Step 2: Update server.js JWT secret config**
  Modify line 116 in `server.js`:
  ```javascript
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is missing.');
  ```

- [ ] **Step 3: Commit Task 1**
  Run commit.

---

### Task 2: Remove OTP Logging Exfiltration

**Files:**
- Modify: [src/worker.js](file:///d:/My%20Applications/Midnigth%20stories/src/worker.js)

- [ ] **Step 1: Clean OTP log output**
  Replace line 1438 in `src/worker.js`:
  ```javascript
  console.log(`[PASSWORD RESET OTP GENERATED] Target: ${cleanEmail} | OTP: ${otp} | Expires: ${expiresAt}`);
  ```
  with:
  ```javascript
  console.log(`[PASSWORD RESET OTP GENERATED] Transaction processed for password reset request.`);
  ```

- [ ] **Step 2: Commit Task 2**
  Run commit.

---

### Task 3: Access Control & Positive Capabilities Check

**Files:**
- Modify: [src/worker.js](file:///d:/My%20Applications/Midnigth%20stories/src/worker.js)
- Modify: [server.js](file:///d:/My%20Applications/Midnigth%20stories/server.js)
- Modify: [admin/src/worker.js](file:///d:/My%20Applications/Midnigth%20stories/admin/src/worker.js)

- [ ] **Step 1: Add permission helpers to src/worker.js**
  Define a static permission capability mapping near line 1030 in `src/worker.js`:
  ```javascript
  const ROLE_PERMISSIONS = {
    admin: ['read_stats', 'moderate_content', 'manage_users', 'manage_settings', 'read_audit_log', 'upload_book', 'edit_book', 'delete_book', 'edit_others_books', 'delete_others_books'],
    user: ['upload_book', 'edit_book', 'delete_book']
  };
  const hasPermission = (role, permission) => {
    return ROLE_PERMISSIONS[role] && ROLE_PERMISSIONS[role].includes(permission);
  };
  ```

- [ ] **Step 2: Refactor role checks in src/worker.js**
  Replace instances of `role !== 'admin'` or `role === 'admin'` with capability checks:
  At line 4118:
  ```javascript
  if (hasPermission(role, 'edit_others_books')) { ... }
  ```
  At lines 4204 and 4268:
  ```javascript
  const isOwner = book.uploaded_by === user.id;
  const canEditOthers = hasPermission(role, 'edit_others_books');
  if (!isOwner && !canEditOthers) {
    return c.json({ error: 'Unauthorized.' }, 403);
  }
  ```
  At line 4214:
  ```javascript
  if (!hasPermission(role, 'moderate_content')) {
    return c.json({ error: 'Unauthorized.' }, 403);
  }
  ```

- [ ] **Step 3: Add permission helpers to server.js**
  Define `ROLE_PERMISSIONS` and `hasPermission` in `server.js` matching `src/worker.js`.
  Refactor role checks at lines 917, 1023, 1033, and 1099 using `hasPermission`.

- [ ] **Step 4: Refactor requirePermission in admin/src/worker.js**
  Remove the `admin.role === 'super_admin'` bypass at lines 159-163 in `admin/src/worker.js`. Seeding must grant `super_admin` role all capabilities in the permissions database.

- [ ] **Step 5: Commit Task 3**
  Run commit.

---

### Task 4: Magic Bytes File Verification

**Files:**
- Modify: [src/worker.js](file:///d:/My%20Applications/Midnigth%20stories/src/worker.js)
- Modify: [server.js](file:///d:/My%20Applications/Midnigth%20stories/server.js)

- [ ] **Step 1: Implement magic byte checker in src/worker.js**
  Add helper function:
  ```javascript
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
  ```
  Call `verifyFileMagicBytes(await file.arrayBuffer(), allowedTypes)` inside the upload endpoint in `src/worker.js`.

- [ ] **Step 2: Implement magic byte checker in server.js**
  Add helper using node `fs`:
  ```javascript
  const fs = require('fs');
  function checkUploadedFileSignature(filePath, allowedExtensions) {
    if (!fs.existsSync(filePath)) return false;
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);
    
    const header = buffer.toString('hex', 0, 4).toUpperCase();
    const allowed = [];
    if (allowedExtensions.includes('.jpg') || allowedExtensions.includes('.jpeg')) allowed.push('FFD8FF');
    if (allowedExtensions.includes('.png')) allowed.push('89504E47');
    if (allowedExtensions.includes('.webp')) allowed.push('52494646');
    if (allowedExtensions.includes('.pdf')) allowed.push('25504446');
    if (allowedExtensions.includes('.epub')) allowed.push('504B0304');
    
    return allowed.some(sig => header.startsWith(sig));
  }
  ```
  Perform checking in `server.js` route handlers immediately after Multer receives files. Delete file via `fs.unlinkSync(req.file.path)` if it fails.

- [ ] **Step 3: Commit Task 4**
  Run commit.

---

### Task 5: User Response DTO & Unbounded Pagination

**Files:**
- Modify: [src/worker.js](file:///d:/My%20Applications/Midnigth%20stories/src/worker.js)

- [ ] **Step 1: Map GET /api/users/:idOrUserId response to DTO**
  Clean up raw database query serialization, only assigning approved keys:
  ```javascript
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
  ```

- [ ] **Step 2: Validate pagination limit bounds**
  Verify and cap `limit` parameters in Stories feed routes:
  ```javascript
  let limitVal = parseInt(limit || 12);
  if (isNaN(limitVal) || limitVal <= 0) limitVal = 12;
  limitVal = Math.min(limitVal, 50);
  ```

- [ ] **Step 3: Commit Task 5**
  Run commit.

---

### Task 6: Error Responses, DDL, and Rate Limit GC

**Files:**
- Modify: [src/worker.js](file:///d:/My%20Applications/Midnigth%20stories/src/worker.js)

- [ ] **Step 1: Sanitize API error responses**
  Strip `err.message` from production JSON API error messages. Replace with generic error reasons.

- [ ] **Step 2: Restrict DDL execution on worker startup**
  Skip schema check and updates if `c.env.ENVIRONMENT === 'production'` or `c.env.AUTO_MIGRATE === 'false'`.

- [ ] **Step 3: GC rateLimitMap Map memory leaks**
  Implement sliding window map cleanup inside the worker:
  ```javascript
  setInterval(() => {
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;
    for (const [key, timestamps] of rateLimitMap.entries()) {
      const active = timestamps.filter(t => now - t < windowMs);
      if (active.length === 0) {
        rateLimitMap.delete(key);
      } else {
        rateLimitMap.set(key, active);
      }
    }
  }, 30 * 60 * 1000);
  ```

- [ ] **Step 4: Commit Task 6**
  Run commit.
