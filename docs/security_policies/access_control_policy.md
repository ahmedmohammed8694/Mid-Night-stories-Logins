# Access Control & Identity Management Policy (NIS2 / ISO 27001 Aligned)

**Document Control**
- **Target Organization**: Midnight Stories Platform (`https://midnightstories.dpdns.org`)
- **Standard Alignment**: ISO/IEC 27001:2022 (A.5.15 - A.5.18), NIS2 Directive (Art. 21)
- **Effective Date**: August 2026
- **Status**: Approved / Operational

---

## 1. Objective & Scope
This policy establishes mandatory identity authentication, role-based access control (RBAC), multi-factor authentication (MFA), and lifecycle credential revocation protocols for all administrators, developers, contractors, and automated service accounts accessing the Midnight Stories platform infrastructure (Cloudflare D1, API routes, admin portals, and deployment channels).

---

## 2. Access Control Principles
1. **Least Privilege Principle**: All accounts are granted only the minimum level of permission required to perform assigned duties.
2. **Need-to-Know Access**: Access to sensitive databases, user PII, and system logs is restricted based on defined operational roles.
3. **Segregation of Duties**: Administrative functions (user moderation, role assignment, system deployment) are partitioned across separate role profiles.

---

## 3. User Role Profiles & Permission Hierarchy

| Role Profile | System Scope | Granted Permissions | Authorization Level |
| :--- | :--- | :--- | :--- |
| **Standard User** | Public Web Portal | Read approved stories, submit content, manage own profile | Authenticated User |
| **Moderator** | Moderation Queue (`/moderation.js`) | Review stories, approve/reject submissions, flag abuse | Moderation Staff |
| **Team Member** | Support Portal (`/tickets`) | Read/reply to support tickets within assigned categories | Customer Support |
| **System Admin** | Admin Dashboard (`admin.html`, D1 DB) | Manage roles, modify settings, execute SQL migrations, ban accounts | System Administrator |
| **Service Account** | Automated Scripts / Wrangler | Read/Write specific APIs, execute scheduled D1 worker tasks | Machine Identity |

---

## 4. Multi-Factor Authentication (MFA / 2FA) Mandate
- **Mandatory Enrolment**: All System Administrators, Developers, and Moderation Staff MUST enforce 2FA via Time-based One-Time Password (TOTP) using standard RFC 6238 libraries (e.g., `otplib`).
- **Recovery Keys**: Emergency backup codes must be stored in secure password vaults; sharing OTP secrets over unencrypted communication channels is prohibited.

---

## 5. Account Lifecycle & Offboarding Protocols
1. **Provisioning**: Administrative access requests must receive documented approval from the System Administrator.
2. **Quarterly Access Review**: Role permissions and active admin accounts must be audited every 90 days.
3. **Immediate Offboarding (24-Hour Rule)**: Upon employee or contractor departure, access credentials, API keys, D1 tokens, and Cloudflare console access MUST be revoked immediately (within a maximum threshold of 2 hours).

---

## 6. Audit & Log Compliance
- All administrative actions (role creation, permission overrides, database updates, account bans) are logged persistently in the `audit_log` and `ticket_audit_logs` tables.
- Log retention follows the statutory 90-day minimum retention period before automated rotation.
