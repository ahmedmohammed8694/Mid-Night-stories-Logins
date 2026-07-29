# Data Retention Policy — Midnight Stories

**Last Updated:** July 30, 2026  
**Owner:** Security & Systems Administration Team

---

## 1. Retention Schedule

| Data Category | Retention Period | Deletion Trigger | Mechanism |
|---|---|---|---|
| Active account data (profile, email, password hash) | Life of account | User account deletion | API deletion & D1 database purge |
| Hashed IP logs (submission rate limiting) | 90 days max | Automated 90-day rolling purge | Automated Worker purge endpoint `/api/admin/system/purge-expired` |
| Submissions (approved stories & comments) | Retained while active | Submitter token deletion or moderator action | Immediate D1 purge & R2 object cleanup |
| Rejected / Removed submissions | 30 days max | Automated 30-day purge | Automated Worker purge endpoint `/api/admin/system/purge-expired` |
| Session tokens | Active session window | Explicit logout or token expiry | Token invalidation |
| Database backups | 30 days rolling | Cloudflare D1 automated backup rotation | Cloudflare managed backup cycle |

---

## 2. Automated Retention Execution

The platform executes automated retention purges via the `/api/admin/system/purge-expired` worker endpoint, ensuring old IP logs are redacted after 90 days and rejected submissions are purged within 30 days.

---

## 3. Contact

**Privacy Officer:** privacy@midnightstories.dpdns.org
