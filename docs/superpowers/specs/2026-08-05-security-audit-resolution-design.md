# Design Specification: Resolving Security Audit Issues
**Date**: 2026-08-05  
**Topic**: Security Audit Resolution  

This document specifies the design changes to resolve the newly identified security vulnerabilities, absolute file path escapes, and resource exhaustion vectors detailed in `security_audit_report.md`.

---

## 1. Proposed Fixes & Approaches

### Fix A: Parameterized Queries (Eliminate Dynamic SQL Interpolation)
- **Files**:
  - `server.js` (L706)
  - `src/worker.js` (L3360)
  - `functions/api/[[route]].js` (L397 & L651)
  - `admin/src/worker.js` (L401)
- **Design**: In all moderation controllers, replace the dynamically interpolated prepared statements `db.prepare(\`UPDATE \${table} ...\`)` with distinct, explicit query branches matching either `'stories'` or `'comments'`.

### Fix B: Resource Exhaustion (Add Pages API Rate Limiting Cleanup)
- **File**: `functions/api/[[route]].js` (L14)
- **Design**: Introduce a periodic sliding-window cleanup interval to prune expired IP entries from the `rateLimitMap` in Hono's Pages functions, bounded by a 30-minute interval task, identical to the express server resolution.

### Fix C: Workspace Isolation (Relative pathing in read_docx.py)
- **File**: `read_docx.py`
- **Design**: Re-write the absolute paths to reference pathing relative to the script execution folder (`__file__`) or local directory referencing, strictly confining it inside the repository folder.

---

## 2. Walkthrough of Changes

### `server.js`
- Modify the admin moderation `/api/admin/moderate` handler to split `UPDATE` actions into `if (target_type === 'story') ... else ...`.

### `src/worker.js`
- Update Hono endpoint `/api/admin/moderate` to query distinct tables conditionally without string interpolation.

### `functions/api/[[route]].js`
- Add the `setInterval` rate limit garbage collection.
- Refactor dynamic `UPDATE` queries in both reports threshold autohide logic (L397) and the admin moderate route (L651).

### `admin/src/worker.js`
- Refactor dynamic `UPDATE` query inside the `/api/admin/moderate` Hono worker endpoint.

### `read_docx.py`
- Modify hardcoded paths to use relative directory markers.
