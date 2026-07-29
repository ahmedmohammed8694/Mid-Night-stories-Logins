# Incident Response Plan — Midnight Stories

**Last Updated:** July 30, 2026  
**Owner:** Lead Security & Infrastructure Engineer

---

## 1. Contacts & Channels

- **Vulnerability Reporting:** `security@midnightstories.dpdns.org` (published at `/.well-known/security.txt`)
- **Emergency Support:** `support@midnightstories.dpdns.org`
- **Hosting Provider:** Cloudflare Operations & Support

---

## 2. Severity Levels & SLA

| Level | Definition | Response SLA |
|---|---|---|
| **SEV-1 (Critical)** | Active data breach, secret exfiltration, DB compromise | Immediate (< 15 mins) |
| **SEV-2 (High)** | Auth bypass, service denial, R2 bucket leakage | < 1 hour |
| **SEV-3 (Medium)** | Non-exploited vulnerability report, minor XSS flaw | < 24 hours |
| **SEV-4 (Low)** | Minor bug, dependency CVE with no attack vector | Next maintenance cycle |

---

## 3. Incident Execution Checklist

1. **Containment**: Immediately revoke compromised API keys (`JWT_SECRET`, Cloudflare tokens) and rotate worker bindings.
2. **Eradication**: Apply patch to worker code, deploy via `npx wrangler deploy`.
3. **Recovery**: Verify system integrity, check D1 tables, confirm SSL and security headers.
4. **Post-Mortem**: Document incident root cause and implement preventative regression tests within 5 business days.
