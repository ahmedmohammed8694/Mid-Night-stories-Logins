# Security Audit Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve security audit flaws including dynamic SQL queries in moderation, rate limiting memory leak in pages api worker, and absolute paths in python documents reader.

**Architecture:**
1. Split all `UPDATE ${table}` queries across Express, Cloudflare Worker backend, and Cloudflare Pages Hono handlers into distinct static SQL queries.
2. Introduce garbage collection to Cloudflare Pages Hono rate limiting map.
3. Replace absolute paths in `read_docx.py` with relative paths.

**Tech Stack:** Node.js, Express, Hono, SQLite, Cloudflare D1, Python.

## Global Constraints
- Confine all file changes inside the workspace directory.
- Preserve backward compatibility for all routing parameters.

---

### Task 1: Fix SQL Table Interpolation in server.js

**Files:**
- Modify: [server.js](file:///d:/My%20Applications/Midnigth%20stories/server.js#L704-L706)

- [ ] **Step 1: Edit server.js moderation update**
  Replace lines 704-706 in `server.js`:
  ```javascript
  const table = target_type === 'story' ? 'stories' : 'comments';

  db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).run(statusMap[action], parseInt(target_id));
  ```
  with:
  ```javascript
  if (target_type === 'story') {
    db.prepare("UPDATE stories SET status = ? WHERE id = ?").run(statusMap[action], parseInt(target_id));
  } else {
    db.prepare("UPDATE comments SET status = ? WHERE id = ?").run(statusMap[action], parseInt(target_id));
  }
  ```

- [ ] **Step 2: Commit**

---

### Task 2: Fix SQL Table Interpolation in src/worker.js

**Files:**
- Modify: [src/worker.js](file:///d:/My%20Applications/Midnigth%20stories/src/worker.js#L3356-L3360)

- [ ] **Step 1: Edit src/worker.js moderation update**
  Replace lines 3356-3360 in `src/worker.js`:
  ```javascript
  const table = target_type === 'story' ? 'stories' : 'comments';
  const targetIdInt = parseInt(target_id);

  try {
    await db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).bind(statusMap[action] || 'approved', targetIdInt).run();
  ```
  with:
  ```javascript
  const targetIdInt = parseInt(target_id);

  try {
    if (target_type === 'story') {
      await db.prepare("UPDATE stories SET status = ? WHERE id = ?").bind(statusMap[action] || 'approved', targetIdInt).run();
    } else {
      await db.prepare("UPDATE comments SET status = ? WHERE id = ?").bind(statusMap[action] || 'approved', targetIdInt).run();
    }
  ```

- [ ] **Step 2: Commit**

---

### Task 3: Fix SQL Table Interpolations in functions/api/[[route]].js

**Files:**
- Modify: [functions/api/[[route]].js](file:///d:/My%20Applications/Midnigth%20stories/functions/api/%5B%5Broute%5D%5D.js#L394-L397) and [functions/api/[[route]].js](file:///d:/My%20Applications/Midnigth%20stories/functions/api/%5B%5Broute%5D%5D.js#L648-L651)

- [ ] **Step 1: Edit reports autohide SQL update**
  Replace lines 394-397 in `functions/api/[[route]].js`:
  ```javascript
  if (reportCount >= thresholdVal) {
    const table = target_type === 'story' ? 'stories' : 'comments';
    await db.prepare(`UPDATE ${table} SET status = 'pending' WHERE id = ? AND status = 'approved'`).bind(targetIdInt).run();
  }
  ```
  with:
  ```javascript
  if (reportCount >= thresholdVal) {
    if (target_type === 'story') {
      await db.prepare("UPDATE stories SET status = 'pending' WHERE id = ? AND status = 'approved'").bind(targetIdInt).run();
    } else {
      await db.prepare("UPDATE comments SET status = 'pending' WHERE id = ? AND status = 'approved'").bind(targetIdInt).run();
    }
  }
  ```

- [ ] **Step 2: Edit moderation SQL update**
  Replace lines 648-651 in `functions/api/[[route]].js`:
  ```javascript
  const table = target_type === 'story' ? 'stories' : 'comments';
  const targetIdInt = parseInt(target_id);

  await db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).bind(statusMap[action], targetIdInt).run();
  ```
  with:
  ```javascript
  const targetIdInt = parseInt(target_id);

  if (target_type === 'story') {
    await db.prepare("UPDATE stories SET status = ? WHERE id = ?").bind(statusMap[action], targetIdInt).run();
  } else {
    await db.prepare("UPDATE comments SET status = ? WHERE id = ?").bind(statusMap[action], targetIdInt).run();
  }
  ```

- [ ] **Step 3: Commit**

---

### Task 4: Fix SQL Table Interpolation in admin/src/worker.js

**Files:**
- Modify: [admin/src/worker.js](file:///d:/My%20Applications/Midnigth%20stories/admin/src/worker.js#L398-L401)

- [ ] **Step 1: Edit admin worker moderation SQL update**
  Replace lines 398-401 in `admin/src/worker.js`:
  ```javascript
  const table = target_type === 'story' ? 'stories' : 'comments';
  const targetIdInt = parseInt(target_id);

  await db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).bind(statusMap[action], targetIdInt).run();
  ```
  with:
  ```javascript
  const targetIdInt = parseInt(target_id);

  if (target_type === 'story') {
    await db.prepare("UPDATE stories SET status = ? WHERE id = ?").bind(statusMap[action], targetIdInt).run();
  } else {
    await db.prepare("UPDATE comments SET status = ? WHERE id = ?").bind(statusMap[action], targetIdInt).run();
  }
  ```

- [ ] **Step 2: Commit**

---

### Task 5: Fix Rate Limiting Memory Leak in functions/api/[[route]].js

**Files:**
- Modify: [functions/api/[[route]].js](file:///d:/My%20Applications/Midnigth%20stories/functions/api/%5B%5Broute%5D%5D.js#L14-L15)

- [ ] **Step 1: Add Map cleanup scheduler**
  Add the following code block right after `const rateLimitMap = new Map();` in `functions/api/[[route]].js`:
  ```javascript
  // Periodic sliding window cleanup to prevent memory leak
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
  }, 30 * 60 * 1000).unref();
  ```

- [ ] **Step 2: Commit**

---

### Task 6: Confine read_docx.py Paths to Workspace

**Files:**
- Modify: [read_docx.py](file:///d:/My%20Applications/Midnigth%20stories/read_docx.py#L32-L35)

- [ ] **Step 1: Make paths relative**
  Replace lines 32-35 in `read_docx.py`:
  ```python
  docx_path = r"d:\My Applications\Webside\Midnight_Stories_Implementation_Plan_V1.01.docx"
  text = docx_to_txt(docx_path)
  with open(r"d:\My Applications\Webside\extracted_text_midnight.txt", "w", encoding="utf-8") as f:
      f.write(text)
  ```
  with:
  ```python
  # Confine paths within repository root using directory locations
  base_dir = os.path.dirname(os.path.abspath(__file__))
  docx_path = os.path.join(base_dir, "Midnight_Stories_Implementation_Plan_V1.01.docx")
  text = docx_to_txt(docx_path)
  with open(os.path.join(base_dir, "extracted_text_midnight.txt"), "w", encoding="utf-8") as f:
      f.write(text)
  ```

- [ ] **Step 2: Commit**
