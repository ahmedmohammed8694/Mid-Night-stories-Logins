# Data Retention Policy

**Last Updated:** [Date]
**Owner:** [Name/Role responsible for maintaining this policy]

## 1. Purpose

This policy defines how long [Company Name] retains different categories of data, and the process for deletion once retention periods expire. It exists to support the Privacy Policy's commitments and reduce risk from holding data longer than necessary.

---

## 2. Retention Schedule

| Data Category | Retention Period | Deletion Trigger | Notes |
|---|---|---|---|
| Active account data (profile, email, password hash) | Life of account | Account deletion request | Deleted/anonymized within [30] days of deletion |
| Inactive/dormant accounts | [X months/years] of inactivity | Automated job flags & notifies user before deletion | Send warning email at [X-30 days] |
| Authentication logs (login attempts, IPs) | [90 days] | Automatic rolling deletion | Needed for security investigation window |
| Session tokens | Until expiry or logout | Session expiry / explicit logout | Never retained beyond active session lifetime |
| Password reset tokens | [15–60 minutes] | Single-use or expiry | Invalidated immediately after use |
| Payment/transaction records | [7 years] | Legal/tax requirement | Retained by payment processor, minimal data held locally |
| Support tickets / communications | [2 years] | Automatic archival then deletion | |
| Application error logs | [30–90 days] | Automatic rolling deletion | Should not contain PII/passwords |
| Backups | [30–90 days rolling] | Oldest backup overwritten | Deleted account data purges from backups on next rotation cycle |
| Marketing/analytics data | [14–26 months] | Per analytics platform default, or shorter if configured | Align with GDPR guidance (max 26 months for GA) |
| Cookie consent records | [Duration of consent validity, e.g. 12 months] | Re-prompt on expiry | |

*Fill in actual periods based on your legal/business requirements. Defaults above are reasonable starting points, not legal minimums or maximums.*

---

## 3. Deletion Process

1. **Account-initiated deletion:** User requests deletion via [settings page / email to privacy@yourdomain.com].
2. **Verification:** Confirm identity of requester.
3. **Execution:** Personal data deleted or irreversibly anonymized within [30] days across:
   - Primary database
   - Backups (on next rotation, or manual purge for immediate legal requests)
   - Third-party processors (analytics, email tools) — trigger their deletion APIs where available
   - Logs (redact/anonymize PII)
4. **Exceptions:** Data retained beyond deletion request only where legally required (e.g., tax records, active legal hold), and only that specific data.
5. **Confirmation:** User notified once deletion is complete.

---

## 4. Legal Holds

If data is subject to a legal hold (litigation, investigation, subpoena), normal retention/deletion schedules are suspended for the relevant data until the hold is lifted. [Designate who has authority to place/lift a hold.]

---

## 5. Review Cadence

This policy is reviewed [annually / every 6 months] or upon material changes to the product, data collected, or applicable law.

---

## 6. Related Documents

- [Privacy Policy](./01-privacy-policy.md)
- [Incident Response Plan](./05-incident-response-plan.md)

---

*This is a template. Actual retention periods should be set based on your specific legal obligations (tax law, GDPR, CCPA, industry regulations) — consult counsel where uncertain.*
