# Code Review Issues Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the critical security vulnerabilities, memory leaks, and logic errors identified during code review in `server.js` and `moderation.js`.

**Architecture:** 
1. Memory Leak: Install sliding-window garbage-collection interval for the in-memory `rateLimitMap` in `server.js`.
2. Timing Attack: Refactor `verifyJWT` in `server.js` to perform signature comparisons in constant-time using `crypto.timingSafeEqual`.
3. Hardcoded Secret: Dynamic binding of user `JWT_SECRET` variable using `process.env.JWT_SECRET`.
4. Toxicity Filter: Re-implement `detectToxicity` in `moderation.js` using regular expression boundary matches to resolve Scunthorpe substring filtering.
5. SQL Safety: Separate the dynamic `reports` database update in `server.js` into distinct conditional operations per target table type.

**Tech Stack:** Node.js, Express, Better-SQLite3, Cryptography.

## Global Constraints
- Do not modify existing Hono worker file (`src/worker.js`) unless explicitly instructed.
- Ensure backwards compatibility with all existing Express endpoints.

---

### Task 1: Fix Memory Leak in `rateLimitMap` (server.js)

**Files:**
- Modify: [server.js](file:///d:/My%20Applications/Midnigth%20stories/server.js#L48-L50)

**Interfaces:**
- Consumes: None
- Produces: Periodic garbage-collection of rateLimitMap

- [ ] **Step 1: Write code modification**
  Add the following code block directly after the `rateLimitMap` definition (line 48) in `server.js`:
  ```javascript
  // Periodic cleanup of expired rate limit entries to prevent memory leaks
  setInterval(() => {
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour window
    for (const [key, timestamps] of rateLimitMap.entries()) {
      const activeTimestamps = timestamps.filter(t => now - t < windowMs);
      if (activeTimestamps.length === 0) {
        rateLimitMap.delete(key);
      } else {
        rateLimitMap.set(key, activeTimestamps);
      }
    }
  }, 30 * 60 * 1000).unref(); // Run every 30 minutes
  ```

- [ ] **Step 2: Verify logic checks out**
  Confirm that `rateLimitMap` entries will be pruned successfully when expired.

- [ ] **Step 3: Commit**
  *(Manual commit as command line is sandboxed)*

---

### Task 2: constant-time JWT signature comparison in `verifyJWT` (server.js)

**Files:**
- Modify: [server.js](file:///d:/My%20Applications/Midnigth%20stories/server.js#L105-L125)

**Interfaces:**
- Consumes: `verifyJWT(token, secret)`
- Produces: Constant-time signature comparison buffer matching.

- [ ] **Step 1: Write code modification**
  Replace lines 116-118 of `server.js`:
  ```javascript
  if (signature !== expectedSignature) {
    throw new Error('Invalid token signature');
  }
  ```
  with:
  ```javascript
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
    throw new Error('Invalid token signature');
  }
  ```

- [ ] **Step 2: Verify logic checks out**
  Ensure timingSafeEqual is correctly compared using Buffer.from.

- [ ] **Step 3: Commit**

---

### Task 3: Environment-Driven `JWT_SECRET` (server.js)

**Files:**
- Modify: [server.js](file:///d:/My%20Applications/Midnigth%20stories/server.js#L102)

**Interfaces:**
- Consumes: `JWT_SECRET`
- Produces: Dynamically resolved JWT key

- [ ] **Step 1: Write code modification**
  Modify line 102 in `server.js`:
  ```javascript
  const JWT_SECRET = process.env.JWT_SECRET || 'midnight_stories_user_secret_2026';
  ```

- [ ] **Step 2: Commit**

---

### Task 4: Whole-Word Toxicity Keyword Matching (moderation.js)

**Files:**
- Modify: [moderation.js](file:///d:/My%20Applications/Midnigth%20stories/moderation.js#L84-L97)

**Interfaces:**
- Consumes: `detectToxicity(text, additionalBanned)`
- Produces: Toxic filter result with regex word boundary checking

- [ ] **Step 1: Write code modification**
  Replace `detectToxicity` in `moderation.js` with:
  ```javascript
  function detectToxicity(text, additionalBanned = []) {
    const allBanned = [...DEFAULT_TOXICITY_KEYWORDS, ...additionalBanned];
    const found = [];
    for (const keyword of allBanned) {
      // Escape special regex characters in keywords, then match whole words only (\b)
      const escapedKeyword = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
      if (regex.test(text)) {
        found.push(keyword);
      }
    }
    return {
      isToxic: found.length > 0,
      keywords: found
    };
  }
  ```

- [ ] **Step 2: Verify logic checks out**
  Ensure `"skyline"` or `"rockystar"` does not trigger toxicity blocks on `"kys"`.

- [ ] **Step 3: Commit**

---

### Task 5: Eliminate Dynamic SQL Table Interpolation in Reports (server.js)

**Files:**
- Modify: [server.js](file:///d:/My%20Applications/Midnigth%20stories/server.js#L492-L495)

**Interfaces:**
- Consumes: None
- Produces: Safe SQL update parameters

- [ ] **Step 1: Write code modification**
  Replace:
  ```javascript
  const table = target_type === 'story' ? 'stories' : 'comments';
  db.prepare(`UPDATE ${table} SET status = 'pending' WHERE id = ? AND status = 'approved'`).run(parseInt(target_id));
  ```
  with:
  ```javascript
  if (target_type === 'story') {
    db.prepare("UPDATE stories SET status = 'pending' WHERE id = ? AND status = 'approved'").run(parseInt(target_id));
  } else {
    db.prepare("UPDATE comments SET status = 'pending' WHERE id = ? AND status = 'approved'").run(parseInt(target_id));
  }
  ```

- [ ] **Step 2: Commit**
