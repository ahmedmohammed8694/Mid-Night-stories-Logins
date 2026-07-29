# Disaster Recovery Plan — Midnight Stories

**Last Updated:** July 30, 2026  
**Target RTO:** 4 Hours  
**Target RPO:** 1 Hour  

---

## 1. Cloud Infrastructure Resilience

- **Database**: Cloudflare D1 SQL managed database with automated point-in-time backups.
- **Media Storage**: Cloudflare R2 distributed object storage.
- **Worker Code**: Git version-controlled and deployed via Cloudflare Workers global edge runtime.

---

## 2. Recovery Procedures

1. **DB Corruption**: Roll back D1 database to clean automatic snapshot via Cloudflare D1 dashboard or CLI (`wrangler d1 execute`).
2. **Code Compromise**: Re-deploy clean build from GitHub repository using `npx wrangler deploy`.
3. **Secret Leak**: Rotate `JWT_SECRET` via `wrangler secret put JWT_SECRET`.
