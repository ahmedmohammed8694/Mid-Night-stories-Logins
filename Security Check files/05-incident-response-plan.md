# Incident Response Plan

**Last Updated:** [Date]
**Owner:** [Name/Role]

## 1. Purpose

This plan defines how [Company Name] detects, responds to, and recovers from security incidents (breaches, unauthorized access, data leaks, DDoS, malware, etc.), and how affected users and authorities are notified where required.

---

## 2. Roles & Contacts

| Role | Name | Contact | Responsibility |
|---|---|---|---|
| Incident Commander | [Name] | [phone/email] | Owns the response, makes final calls |
| Technical Lead | [Name] | [phone/email] | Investigates, contains, remediates |
| Communications Lead | [Name] | [phone/email] | User/customer/press communication |
| Legal Contact | [Name/firm] | [phone/email] | Breach notification law compliance |
| Hosting/Infra Provider Support | [Provider] | [support link/phone] | Infrastructure-level response |

**Security vulnerability reports:** `security@yourdomain.com` (also published at `/.well-known/security.txt`)

---

## 3. Severity Levels

| Level | Definition | Example | Response Time |
|---|---|---|---|
| **SEV-1 (Critical)** | Active data breach, full system compromise, PII exposed | DB dump exfiltrated, admin account compromised | Immediate, all-hands |
| **SEV-2 (High)** | Significant vulnerability actively exploited, service down | Auth bypass found in the wild, ransomware | < 1 hour |
| **SEV-3 (Medium)** | Vulnerability discovered, not yet exploited | Responsible disclosure of XSS bug | < 24 hours |
| **SEV-4 (Low)** | Minor issue, no user impact | Outdated dependency with low-severity CVE | Next sprint |

---

## 4. Response Phases

### Phase 1 — Detection & Triage
- Alert received via [monitoring tool / security.txt report / user report / manual discovery]
- Incident Commander assigns severity level
- Create incident channel/log (e.g., dedicated Slack channel + doc) with timestamped entries

### Phase 2 — Containment
- Isolate affected systems (revoke compromised credentials, disable affected endpoints, block malicious IPs)
- Rotate any leaked secrets/API keys/tokens immediately (see Section 6)
- Preserve evidence (logs, snapshots) before remediation destroys forensic trail

### Phase 3 — Eradication
- Identify and fix root cause (patch vulnerability, remove malware, close exposed port, etc.)
- Verify fix in staging before deploying to production where feasible

### Phase 4 — Recovery
- Restore affected systems/data from clean backups if needed
- Monitor closely post-recovery for recurrence
- Confirm normal operations restored

### Phase 5 — Notification
- Determine if affected users and/or regulators must be notified (see Section 5)
- Communications Lead drafts and sends notifications within legally required timeframe
- Post public status update if the incident was customer-visible

### Phase 6 — Post-Incident Review
- Blameless retrospective within [5 business days]
- Document: what happened, timeline, root cause, what worked, what didn't
- Assign action items to prevent recurrence, with owners and deadlines

---

## 5. Breach Notification Requirements

- **GDPR (EU/UK):** Notify supervisory authority within **72 hours** of becoming aware, if the breach risks individuals' rights/freedoms. Notify affected individuals without undue delay if high risk.
- **US state laws:** Vary by state (e.g., California requires "the most expedient time possible and without unreasonable delay"). Check requirements for every state you have users in.
- **Other jurisdictions:** [Add as applicable — PIPEDA (Canada), etc.]

See the [Data Breach Notification Plan](./06-data-breach-notification-plan.md) for notification templates and the decision tree for who must be told.

---

## 6. Secret Rotation Procedure

If credentials/API keys/tokens are suspected leaked:
1. Immediately revoke/rotate the credential at the source (provider dashboard or CLI)
2. Deploy the new credential via environment variables/secrets manager (never commit to git)
3. Invalidate all active sessions if session secrets were affected
4. Audit access logs for the exposure window for signs of misuse
5. Document the rotation in the incident log

---

## 7. Communication Templates

Keep pre-drafted templates ready for:
- Internal status updates
- Customer-facing incident notice (in-app / status page)
- Regulatory notification
- Affected-user breach notification (see companion document)

---

## 8. Testing This Plan

- Run a tabletop exercise (simulated incident walkthrough) at least [annually]
- Update contact info and tooling references after any team/infra changes

---

*This is a template. Legal notification deadlines and requirements vary by jurisdiction and data type — have counsel review Section 5 specifically.*
