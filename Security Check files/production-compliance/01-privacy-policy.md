# Privacy Policy — Midnight Stories

**Last Updated:** July 30, 2026

Midnight Stories ("we," "us," or "our") operates https://midnightstories.dpdns.org (the "Service"). This Privacy Policy explains what personal data we collect, why we collect it, how we use it, and the choices you have.

By using the Service, you agree to the collection and use of information in accordance with this policy.

---

## 1. Information We Collect

### 1.1 Information You Provide
- Account information: Full name, email address, password (hashed via bcrypt)
- Submissions: Stories, comments, and support tickets submitted to the platform
- Communications: Support requests and feedback sent to support@midnightstories.dpdns.org

### 1.2 Information Collected Automatically
- Log data: Cryptographically hashed IP addresses (SHA-256 with secret salt), browser headers, timestamps
- Functional Storage & Cookies: Theme preference (dark/light) and banner dismissal states stored locally
- Device information: Standard browser User-Agent strings for abuse mitigation

### 1.3 Media Uploads
- All EXIF metadata, GPS location coordinates, and device hardware signatures are stripped server-side prior to R2 object storage.

---

## 2. How We Use Your Information

We use collected information to:
- Provide, operate, and maintain the anonymous sharing platform
- Authenticate administrative and author accounts securely
- Enforce community safety and rate limiting via hashed IP checks
- Send transactional notices (password resets, support ticket replies)
- Comply with applicable legal obligations

We do **not** sell your personal data or monetize personal stories.

---

## 3. Legal Basis for Processing (GDPR)

If you are located in the EEA/UK, we process data under:
- **Consent** — Explicit agreement to functional cookies and terms
- **Contract** — Necessary processing to provide user accounts and story publishing
- **Legitimate Interest** — Fraud prevention, moderation, and automated abuse detection
- **Legal Obligation** — Mandatory compliance with valid legal orders

---

## 4. How We Share Your Information

We do **not** sell personal data. Data is shared strictly with infrastructure providers bound by privacy contracts:

| Category | Purpose | Provider |
|---|---|---|
| Cloud Infrastructure & WAF | Edge hosting, DDoS protection, D1 DB | Cloudflare, Inc. |
| Object Storage | Image media hosting (EXIF stripped) | Cloudflare R2 |
| Legal Authorities | Valid subpoena or court order | Law enforcement |

---

## 5. Data Retention

- Account data is retained while your account is active.
- Hashed IP logs are retained for up to 90 days, then automatically purged/redacted.
- Rejected or removed submissions are deleted within 30 days.
- See our Data Retention Policy for full category details.

---

## 6. Cookies & Local Storage

We use minimal, functional cookies and local storage:
- **Essential Session Tokens**: Maintain authenticated sessions securely (`HttpOnly`, `Secure`).
- **Preferences**: Remember dark/light theme choice and cookie notice decisions.

You can manage preferences anytime via the **Cookie Settings** link in our footer.

---

## 7. Data Security

We implement industry-standard safeguards:
- Strict HTTPS/TLS encryption in transit and at rest
- Bcrypt password hashing
- Web Crypto HMAC SHA-256 JWT tokens
- Automated content safety scanning
- Security headers (`HSTS`, `X-Frame-Options`, `X-Content-Type-Options: nosniff`, `CSP`)

---

## 8. Your Rights

You have the right to:
- **Access** data associated with your account or submitter token
- **Delete** your data or request complete account erasure
- **Export** your data in portable JSON format
- **Object to** or restrict processing

To exercise these rights, contact **privacy@midnightstories.dpdns.org** or **support@midnightstories.dpdns.org**.

---

## 9. Contact Us

Questions about this policy or your data:

**Email:** privacy@midnightstories.dpdns.org / support@midnightstories.dpdns.org  
**Platform:** https://midnightstories.dpdns.org  
