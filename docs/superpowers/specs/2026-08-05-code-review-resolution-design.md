# Design Specification: Resolving Code Review Issues
**Date**: 2026-08-05  
**Topic**: Code Review Resolution  

This document specifies the design changes to resolve the critical vulnerabilities, memory leaks, and logic bugs identified in `code_review_report.md`.

---

## 1. Proposed Fixes & Approaches

### Fix A: In-Memory Rate Limiting Memory Leak
- **File**: `server.js`
- **Design**: Introduce a sliding window garbage-collection mechanism via a periodic `setInterval` task that iterates over the `rateLimitMap` keys. It will filter out expired timestamps and delete the key entirely if no active timestamps remain. This keeps the memory usage bounded.

### Fix B: JWT Signature Verification Timing Attack
- **File**: `server.js`
- **Design**: Replace the `signature !== expectedSignature` character-by-character early-exit check in `verifyJWT` with `crypto.timingSafeEqual`. To avoid length-mismatch errors in `timingSafeEqual`, we will first check if the signature lengths match, and convert both strings into Buffers.

### Fix C: Environment-Driven User JWT Secret
- **File**: `server.js`
- **Design**: Replace the hardcoded `JWT_SECRET` constant with a dynamic lookup of `process.env.JWT_SECRET` falling back to the hardcoded string ONLY for local development fallback, adding a warning log if the secret key is defaulted.

### Fix D: Toxicity filter Scunthorpe Problem (Whole-Word Matching)
- **File**: `moderation.js`
- **Design**: Modify `detectToxicity` to match keywords using word boundaries (`\bkeyword\b`) via regular expressions. This ensures substring components of larger normal words (such as `"skyline"`) do not trigger a toxicity alert for the keyword `"kys"`.

### Fix E: Safe Querying (Remove Dynamic Interpolation)
- **File**: `server.js`
- **Design**: In `/api/reports`, remove the dynamic table name interpolation (`UPDATE ${table} ...`) and split the operation into distinct table-specific statements.

---

## 2. Walkthrough of Changes

### `server.js`
1. Add cleanup interval for `rateLimitMap`.
2. Update `verifyJWT` to use `crypto.timingSafeEqual`.
3. Check `process.env.JWT_SECRET` first.
4. Replace dynamic table query in `/api/reports` with a clean conditionally selected database statement.

### `moderation.js`
1. Re-implement `detectToxicity` using regex word boundaries.
