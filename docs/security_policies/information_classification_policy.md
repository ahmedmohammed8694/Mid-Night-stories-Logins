# Information Classification & Data Protection Policy (ISO 27001 / NIS2 Aligned)

**Document Control**
- **Target Organization**: Midnight Stories Platform (`https://midnightstories.dpdns.org`)
- **Standard Alignment**: ISO/IEC 27001:2022 (A.5.12, A.5.13, A.8.24), NIS2 Directive
- **Effective Date**: August 2026
- **Status**: Approved / Operational

---

## 1. Objective & Classification Schema
This policy defines the data classification tiers for Midnight Stories data assets, prescribing required technical handling, encryption, transmission, and sanitization standards.

---

## 2. Data Classification Matrix

| Tier | Category Name | Description & Data Examples | Storage & Encryption Standard | Transmission Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **Public** | Approved published stories, public book directory, site announcements, static pages. | Public web caching (Cloudflare CDN / D1). | Standard HTTPS (TLS 1.2+). |
| **Tier 2** | **Internal Use** | Anonymized usage statistics, public ticket subcategories, platform documentation, non-sensitive site configuration. | Protected server environments, access restricted to platform team. | Encrypted HTTPS / TLS 1.3. |
| **Tier 3** | **Confidential / Restricted** | User PII (email, full name, phone number, DOB), password hashes (`bcryptjs`), OTP secrets, unmoderated draft stories, support attachments, D1 database backups, API secrets. | Encrypted at rest (AES-256), DB access restricted via strict RBAC, secrets stored in Cloudflare Workers environment bindings (`.dev.vars`). | Mandatory TLS 1.3, strict payload validation, no logging of plain credentials. |

---

## 3. Mandatory Encryption Standards
- **Data at Rest**: All D1 SQLite database instances, Cloudflare storage buckets, and server backups must utilize AES-256 encryption.
- **Passwords & Auth Credentials**: Passwords MUST be salted and hashed using `bcryptjs` with adequate cost factors (minimum 10 rounds). Plaintext passwords must never be stored, cached, or logged.
- **Data in Transit**: Web traffic and API calls must strictly enforce HTTPS (TLS 1.2 minimum, TLS 1.3 preferred) with HTTP Strict Transport Security (HSTS) headers enabled.

---

## 4. Data Masking & Sanitization Protocols
- **IP Address Anonymization**: IP addresses captured for rate limiting must be cryptographically hashed (SHA-256 + salt) prior to persistence.
- **EXIF & Image Metadata Stripping**: All user-uploaded story images and support attachments must be processed via image re-encoding tools to strip EXIF metadata, GPS coordinates, and camera serial numbers before disk storage.

---

## 5. Disposal & Deletion Requirements
- Expired OTP password reset tokens and temporary upload scratch files must be purged automatically after expiration.
- User account deletion requests must remove associated Tier 3 PII from active D1 database tables within 30 days.
