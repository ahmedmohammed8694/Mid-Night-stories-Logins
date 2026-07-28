# 🔐 Website Security Checklist — Pre-Launch Edition

*Combines Replit's official Security Checklist and the community "vibe-security" checklist (astoj/vibe-security) into one master list to run through before you publish your site.*

Use this as a literal checklist: go section by section, check off `[ ]` → `[x]`, and don't publish until the "Must-Fix Before Launch" items are done.

---

## 1. Authentication

- [x] Using a trusted, actively maintained auth library/platform (e.g., Replit Auth, Clerk, Auth0) instead of hand-rolled auth
- [x] Passwords are hashed + salted (bcrypt/argon2/scrypt) — never stored in plain text or with weak hashing (MD5/SHA1)
- [x] Multi-factor authentication (MFA) available, especially for admin/privileged accounts
- [x] Secure password reset flow (time-limited tokens/links, not guessable)
- [x] Session expiration policy in place (sessions don't live forever)
- [x] Every API request is authenticated — no endpoint trusts an unauthenticated caller by default

### 1a. Login Form Specifics

- [x] Login errors are generic ("Invalid credentials.") — never reveal whether it was the email or the password that was wrong
- [x] Account lockout / temporary cooldown after repeated failed login attempts
- [x] Rate limiting applied per IP and per account on the login endpoint
- [x] Passwords never logged, echoed back in responses, or sent via email
- [x] Password field uses `type="password"` and autocomplete attributes set correctly (`autocomplete="current-password"` / `"new-password"`)
- [x] Minimum password strength enforced (length ≥ 8–12 chars)
- [x] Persistent login tokens are random, long-lived tokens stored server-side — not the password or a predictable value
- [x] Login page itself served over HTTPS
- [x] Bot-detection and IP hashing on login attempts

### 1b. Signup / Registration

- [x] New accounts default to least-privilege role (never default to admin)
- [x] Duplicate-account signals handled carefully — generic response handling

### 1c. Forgot Password / Password Reset Flow

- [x] Password reset tokens are single-use and cryptographically signed
- [x] Reset token is invalidated immediately after use
- [x] User sessions invalidated upon password change

## 2. Authorization & Access Control

- [x] Middleware/guards check auth status and role **before** granting access to protected routes
- [x] Explicit permission checks before every sensitive action (`hasPermission`, `requirePermission`, `requireAdmin`)
- [x] Role-Based Access Control (RBAC) defined: admin / employee / user / guest with least-privilege access
- [x] No "security by obscurity" — protected by server-side verification

### 2a. Session Security

- [x] Session tokens are long, random JWTs signed using Web Crypto HMAC SHA-256
- [x] Sessions expire after lifetime window
- [x] Logout invalidates session tokens client and server side
- [x] Ability to revoke active sessions and enforce account bans immediately

## 3. Front-End Security

- [x] HTTPS enforced everywhere
- [x] All user input sanitized before rendering (prevents XSS)
- [x] Parameterized DB bindings used across all D1 queries
- [x] No sensitive API keys or secret keys in client-side code

## 4. Secrets & Sensitive Data

- [x] All secrets stored in Cloudflare Worker environment bindings (`c.env`) — never hardcoded
- [x] Credentials and PII sanitized/redacted in logs

## 5. API & Backend Security

- [x] Every sensitive API endpoint requires authentication
- [x] CORS configured via Hono `cors()` middleware
- [x] Content moderation & PII detection pipeline active for submissions

## 6. Input Validation & Injection Prevention

- [x] All user input validated server-side
- [x] Parameterized SQL queries used for all database access — zero raw unparameterized SQL

## 7. Database Security

- [x] Managed Cloudflare D1 SQL database with parameterized query bindings
- [x] Database not publicly exposed to the internet

## 8. Error Handling & Logging

- [x] Generic, user-friendly error messages shown to users
- [x] Detailed errors logged server-side only

## 9. Security Headers & Secure Communications

- [x] HTTPS enforced site-wide with Cloudflare SSL/TLS
- [x] Security headers set: `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`
- [ ] Site scanned at [securityheaders.com](https://securityheaders.com) with a good grade

## 10. Cookies

- [ ] `HttpOnly` flag set (prevents JS access to cookies)
- [ ] `Secure` flag set (cookie only sent over HTTPS)
- [ ] `SameSite` attribute set appropriately (CSRF mitigation)

## 11. File Uploads (if applicable)

- [ ] File types restricted by actual content inspection (magic bytes/MIME sniffing), not just by trusting the file extension
- [ ] Max file size enforced server-side (not just in the front-end form)
- [ ] Uploaded files scanned for malware/viruses (e.g., ClamAV, VirusTotal API, or your host's built-in scanning) before being made accessible
- [ ] Files stored in dedicated object storage or a separate domain/subdomain, not directly in the web root or app's execution path
- [ ] Uploaded filenames regenerated server-side (random name) — never trust or execute user-supplied filenames
- [ ] Uploaded images re-encoded/re-processed (e.g., resized) rather than served as-is, to strip embedded scripts/metadata
- [ ] Uploaded files served with a `Content-Disposition` header and correct `Content-Type` so browsers don't execute them as scripts

## 12. Malware, Virus & Attack Protection

- [ ] Server/hosting environment has malware scanning or a managed platform that handles it (Replit, Vercel, AWS, etc. patch and monitor infrastructure automatically)
- [ ] Web Application Firewall (WAF) in place (e.g., Cloudflare, AWS WAF) to filter malicious traffic before it reaches your app
- [ ] DDoS protection enabled, typically via a CDN/proxy in front of your app (Cloudflare, Fastly, AWS Shield)
- [ ] Bot protection / anti-scraping on sensitive endpoints (login, signup, checkout, search) — CAPTCHA, honeypots, or behavioral bot detection
- [ ] Brute-force protection on all authentication-adjacent endpoints (login, password reset, 2FA code entry, signup)
- [ ] Antivirus/malware scanning on any user-generated content pipeline (uploads, imported files, plugins)
- [ ] Regular automated vulnerability/malware scans of the live site (e.g., Sucuri SiteCheck, Google Safe Browsing status check)
- [ ] Admin panel / CMS not using default credentials, and ideally not exposed at a predictable public URL (or protected by IP allow-listing / extra auth)
- [ ] Third-party scripts/widgets (analytics, chat widgets, ads) loaded from trusted sources only, with Subresource Integrity (SRI) hashes where possible — a compromised third-party script is a common attack vector
- [ ] Clickjacking protection via `X-Frame-Options: DENY` or `frame-ancestors` in CSP
- [ ] Server/software kept patched — OS, runtime (Node/Python/etc.), and framework versions up to date

## 13. Hosting & Infrastructure

- [ ] Hosted on a managed, reputable platform (Replit, Vercel, AWS, GCP, etc.) with automatic patching
- [ ] Firewall and DDoS protection in place (e.g., via CDN like Cloudflare)
- [ ] If using Infrastructure as Code (Terraform, CloudFormation): scanned for misconfigurations (e.g., Checkov)
- [ ] Cloud resources follow least-privilege permissions

## 14. Dependency Management

- [ ] `npm audit` (or language equivalent) run with no high/critical vulnerabilities outstanding
- [ ] Automated dependency scanning enabled (Dependabot, Snyk, etc.)
- [ ] Dependencies reasonably up to date and actively maintained

## 15. Testing & Auditing

- [ ] Basic vulnerability scan run (OWASP ZAP, Burp Suite, or similar)
- [ ] Manual click-through of auth/authz flows attempting to access things you shouldn't
- [ ] Static/dynamic code analysis run if available in your stack

## 16. Backup & Disaster Recovery

- [ ] Automated backups configured and stored remotely
- [ ] Backup restoration tested at least once
- [ ] Basic disaster recovery plan written down (what do you do if the DB is wiped or the site is breached?)

## 17. Privacy & Data Protection

- [ ] Privacy policy published, clearly disclosing what data you collect, why, and how long you keep it
- [ ] Cookie consent banner shown if you use tracking/analytics cookies, with a genuine opt-out (not just "OK" with no real choice)
- [ ] Only collecting data you actually need (data minimization) — don't ask for fields "just in case"
- [ ] Personally identifiable information (PII) — names, emails, addresses, payment info — encrypted at rest
- [ ] Users can request their data be deleted or exported (GDPR "right to be forgotten" / data portability), if you operate in or serve GDPR-covered regions
- [ ] Data shared with third parties (analytics, ad networks, payment processors) is disclosed in the privacy policy
- [ ] If handling payments, you are not storing raw card numbers yourself — use a PCI-compliant processor (Stripe, PayPal, etc.)
- [ ] Data retention policy defined — old/unused user data is deleted rather than kept forever
- [ ] If the site targets children, applicable child-privacy laws (e.g., COPPA) are considered

## 18. Incident Response

- [ ] Basic incident response plan exists — who does what if there's a breach
- [ ] A way to quickly rotate/revoke leaked secrets or credentials if needed
- [ ] A designated contact/email for security researchers to report vulnerabilities responsibly (e.g., `security@yourdomain.com` or a `/.well-known/security.txt` file)
- [ ] Plan for notifying affected users if a data breach occurs (required by law in many jurisdictions)

---

## 🚦 Must-Fix Before Launch (minimum bar)

If you only have time for a subset, don't publish without these:

1. HTTPS enforced everywhere
2. No secrets/API keys in client-side code or committed to git
3. All input sanitized + parameterized queries (no SQL injection / XSS holes)
4. Every sensitive API route requires authentication + authorization checks
5. Passwords hashed, never plain text
6. Generic error messages to users; detailed errors only in server logs
7. Rate limiting + account lockout on login and password-reset endpoints
8. Password reset flow uses single-use, expiring tokens and doesn't reveal whether an email is registered
9. Session cookies are `HttpOnly` + `Secure`, and logout invalidates the session server-side
10. Basic bot/DDoS protection in front of the site (e.g., Cloudflare)
11. Privacy policy published and only necessary personal data collected

---

*Sources: [Replit Security Checklist](https://docs.replit.com/learn/security-checklist) and [astoj/vibe-security](https://github.com/astoj/vibe-security) (web-app-security.md).*
