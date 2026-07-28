# Disaster Recovery Plan

**Last Updated:** [Date]
**Owner:** [Name/Role]

## 1. Purpose

Defines how [Company Name] recovers the Service after a catastrophic event: database loss, infrastructure failure, ransomware, or a security breach requiring full rebuild.

---

## 2. Recovery Objectives

| Metric | Target | Notes |
|---|---|---|
| **RTO** (Recovery Time Objective) | [e.g., 4 hours] | Max acceptable downtime |
| **RPO** (Recovery Point Objective) | [e.g., 1 hour] | Max acceptable data loss, based on backup frequency |

---

## 3. Backup Strategy

| Data | Frequency | Retention | Storage Location | Encrypted? |
|---|---|---|---|---|
| Primary database | [Daily / hourly / continuous] | [30 days rolling] | [Separate region/provider from primary DB] | Yes |
| File/object storage (uploads) | [Daily] | [30 days rolling] | [S3 versioning / separate bucket] | Yes |
| Application config/secrets | [On change] | [Version-controlled in secrets manager] | [Secrets manager, e.g., Vault/AWS Secrets Manager] | Yes |
| Infrastructure-as-code | Every commit | Git history | [GitHub/GitLab] | N/A (no secrets in IaC) |

**Backups are stored remotely/off-site from production infrastructure** — never solely on the same server as the live database.

---

## 4. Disaster Scenarios & Response

### Scenario A: Database Corrupted or Wiped
1. Stop write traffic to prevent further corruption (maintenance mode)
2. Identify most recent clean backup (verify integrity before restoring)
3. Restore to a new instance, not overwriting the last-known-good backup
4. Validate data integrity with spot checks against known records
5. Point application to restored instance; resume traffic
6. Post-mortem: how did corruption/wipe happen, was it an attack?

### Scenario B: Hosting Provider Outage
1. Check provider status page to confirm scope
2. If prolonged, execute failover to [secondary region/provider] per runbook: [link]
3. Update DNS/load balancer to route to failover environment
4. Communicate status to users via status page

### Scenario C: Ransomware / Full Compromise
1. Isolate affected systems immediately — do not pay ransom without legal/law enforcement guidance
2. Assume all credentials on affected systems are compromised — rotate everything
3. Rebuild from clean infrastructure-as-code + verified-clean backups (never restore directly from a possibly-infected backup without scanning)
4. Follow [Incident Response Plan](./05-incident-response-plan.md) in parallel for breach notification obligations

### Scenario D: Accidental Deletion (human error)
1. Identify scope (which records/tables/files)
2. Restore only affected data from most recent backup pre-dating the deletion, where possible, to avoid overwriting unrelated recent changes
3. Reconcile any data created between backup time and deletion time, if recoverable from logs

---

## 5. Roles During a DR Event

| Role | Responsibility |
|---|---|
| Incident Commander | Declares disaster, coordinates response |
| Technical Lead | Executes restoration steps |
| Communications Lead | Updates status page/users |

*(Same roles as Incident Response Plan — DR is typically a subset of incident response.)*

---

## 6. Backup Restoration Testing

- Restoration must be tested at least **[quarterly / semi-annually]** in a non-production environment
- Log each test: date, data restored, time taken, issues found
- Update this plan if the restoration process changes

| Test Date | Result | Time to Restore | Issues Found | Tester |
|---|---|---|---|---|
| [Date] | [Pass/Fail] | [Xh Ym] | [notes] | [Name] |

---

## 7. Communication Plan During Extended Downtime

- Status page updated within [15–30 min] of detection
- Email to users if downtime exceeds [X hours]
- Internal stakeholders updated every [30–60 min] until resolved

---

## 8. Related Documents

- [Incident Response Plan](./05-incident-response-plan.md)
- [Data Breach Notification Plan](./06-data-breach-notification-plan.md)

---

*This is a template. Fill in actual RTO/RPO based on your business needs, and test the restoration process before you need it for real.*
