# IT Security & Acceptable Use Policy (ISO 27001 / NIS2 Aligned)

**Document Control**
- **Target Organization**: Midnight Stories Platform (`https://midnightstories.dpdns.org`)
- **Standard Alignment**: ISO/IEC 27001:2022 (A.5.10, A.7.7, A.8.7), NIS2 Directive
- **Effective Date**: August 2026
- **Status**: Approved / Operational

---

## 1. Objective & Application
This policy outlines security responsibilities for all administrators, developers, content moderators, and personnel operating or maintaining the Midnight Stories platform hardware, software, and administrative consoles.

---

## 2. Workstation & System Security Rules
1. **Device Encryption**: All laptops or workstations used for developing or administering Midnight Stories must have full-disk encryption (BitLocker / FileVault) enabled.
2. **Screen Lock Automation**: Inactive administrative workstations must automatically lock after 5 minutes of inactivity.
3. **Prohibited Software**: Installing unapproved executable files, unauthorized network scanners, peer-to-peer sharing software, or untrusted browser extensions on administrative hardware is strictly forbidden.

---

## 3. Credential & Environment Variable Security
- **No Hardcoded Credentials**: API tokens, Cloudflare D1 tokens, database connection strings, and JWT secrets MUST NEVER be committed to Git repositories or public code hosting.
- **Environment Isolation**: Secrets must be injected exclusively via secure environment variables (`.dev.vars` / Wrangler Secrets).

---

## 4. Incident Reporting & Escalation
Personnel who observe or suspect a potential security breach, leak of credentials, unauthorized access attempt, or data exposure MUST report the incident within **1 hour** to `privacy@midnightstories.dpdns.org` or escalate directly to system administrators.
