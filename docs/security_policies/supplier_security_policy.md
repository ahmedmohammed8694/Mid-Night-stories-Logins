# Supplier & Supply Chain Security Policy (ISO 27001 / NIS2 Aligned)

**Document Control**
- **Target Organization**: Midnight Stories Platform (`https://midnightstories.dpdns.org`)
- **Standard Alignment**: ISO/IEC 27001:2022 (A.5.19 - A.5.22), NIS2 Directive (Supply Chain Security)
- **Effective Date**: August 2026
- **Status**: Approved / Operational

---

## 1. Objective & Scope
This policy mandates vendor screening, third-party risk assessment, package dependency auditing, and contract security requirements for all software libraries, cloud service providers, and API vendors integrated into the Midnight Stories ecosystem.

---

## 2. Third-Party Service Provider Inventory & Assessment

| Vendor / Component | Service Category | Security Certification & Controls | Risk Tier |
| :--- | :--- | :--- | :--- |
| **Cloudflare Inc.** | Edge Hosting, CDN, D1 DB | ISO 27001, SOC 2 Type II, GDPR DPA | High (Core Infra) |
| **Google Cloud / Identity** | OAuth 2.0 Authentication | ISO 27001, SOC 2/3, FedRAMP | High (Identity) |
| **NPM Package Vendors** | Node.js Libraries (`express`, `hono`, `otplib`, `bcryptjs`) | Automated vulnerability scanning (`npm audit`), lockfile integrity (`package-lock.json`) | Medium (Dependencies) |

---

## 3. Dependency & Supply Chain Security Controls
1. **Dependency Pinning**: All production dependencies must be pinned to explicit versions in `package.json` and locked via `package-lock.json`.
2. **Automated Vulnerability Scanning**: `npm audit` or automated security bots must be run prior to every production release deployment (`wrangler deploy`). Any dependency containing critical or high CVE vulnerabilities must be patched or replaced prior to deployment.
3. **Vendor Security Auditing**: Third-party SaaS providers must hold active ISO 27001 or SOC 2 Type II compliance reports and sign Data Processing Addendums (DPAs) where user PII is processed.

---

## 4. Offboarding Vendor Services
When terminating or replacing a third-party service provider or software dependency:
- API access keys, OAuth credentials, and Webhooks must be invalidated immediately.
- All vendor data retention obligations must be verified to confirm full erasure of Midnight Stories data from vendor systems.
