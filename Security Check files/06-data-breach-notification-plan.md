# Data Breach Notification Plan

**Last Updated:** [Date]

Companion to the [Incident Response Plan](./05-incident-response-plan.md). This document covers *who* must be notified after a confirmed breach, *within what timeframe*, and provides ready-to-use templates.

---

## 1. Decision Tree: Do We Need to Notify?

1. **Was personal data involved?** (names, emails, passwords, payment info, etc.) → If no, internal incident only, no external notification required.
2. **Was the data actually exposed/accessed**, not just theoretically vulnerable? → If unconfirmed, treat as a breach until forensics rule it out.
3. **Is the data encrypted/hashed such that exposure is not usable?** (e.g., properly hashed passwords) → May reduce but not always eliminate notification obligation — check jurisdiction rules.
4. **Does it meet the "risk to individuals" threshold** under GDPR or state law? → If yes, notification required.

When in doubt, consult legal counsel before deciding not to notify — under-notifying carries significant legal and reputational risk.

---

## 2. Who to Notify & Deadlines

| Recipient | Trigger | Deadline | Owner |
|---|---|---|---|
| Data Protection Authority (GDPR) | Breach risks rights/freedoms of EU/UK individuals | 72 hours from awareness | Legal Contact |
| Affected individuals (GDPR) | High risk to individuals | Without undue delay | Communications Lead |
| US state Attorneys General | Varies by state law and record count | Varies (often 30–60 days) | Legal Contact |
| Affected US users | PII breach per applicable state law | "Most expedient time possible" | Communications Lead |
| Payment processor / card networks | Card data potentially exposed | Immediately | Technical Lead |
| Cyber insurance provider (if applicable) | Any qualifying incident | Per policy terms, often 24–72h | Incident Commander |
| Internal leadership/board | Any SEV-1/SEV-2 | Immediately | Incident Commander |

---

## 3. Information to Include in User Notification

- What happened (plain language, no jargon)
- What data was involved
- When it happened and when you discovered it
- What you've done to contain it
- What the user should do (e.g., reset password, monitor accounts, enable MFA)
- Contact point for questions
- Whether you're offering credit monitoring (if financial data exposed)

---

## 4. Template: User Breach Notification Email

```
Subject: Important Security Notice About Your [Company Name] Account

Hi [Name],

We're writing to let you know about a security incident that may have
affected your account.

What happened:
On [date], we discovered [brief description, e.g., "unauthorized access to
a database containing user account information"]. We immediately
[contained the issue — e.g., revoked access, patched the vulnerability].

What information was involved:
[e.g., "Your email address and hashed password. Your password was not
stored in plain text and was not directly readable."]

What we're doing:
- [Action 1, e.g., "Rotated all affected credentials"]
- [Action 2, e.g., "Engaged a third-party security firm to investigate"]
- [Action 3, e.g., "Added additional monitoring"]

What you should do:
- Reset your password at [link], especially if reused elsewhere
- Enable multi-factor authentication if you haven't already
- Watch for phishing attempts referencing this incident

We take this extremely seriously and apologize for the concern this
may cause. Questions can be directed to [security@yourdomain.com].

[Signature]
[Company Name]
```

---

## 5. Template: Regulatory Notification (GDPR Art. 33)

```
To: [Supervisory Authority]
Re: Personal Data Breach Notification

1. Nature of the breach: [description]
2. Categories and approximate number of data subjects affected: [#]
3. Categories and approximate number of records affected: [#]
4. Name/contact of Data Protection Officer or contact point: [name/email]
5. Likely consequences of the breach: [description]
6. Measures taken or proposed to address the breach: [description]
7. Date/time breach occurred and was discovered: [dates]

Submitted by: [Name, Title]
Date: [Date]
```

---

## 6. Template: Public Status Page Update

```
[Date] — We are investigating a security incident affecting [scope].
We have taken [containment steps] and are working to fully resolve
the issue. We will post updates here as we learn more.
Affected users have been notified directly via email.
```

---

## 7. Post-Notification

- Log all notifications sent (recipient, date, method) for compliance records
- Monitor support channels for user questions/concerns following notification
- Include notification summary in the post-incident review

---

*This is a template. Notification deadlines, thresholds, and required content vary significantly by jurisdiction (GDPR, US state laws, sector-specific rules like HIPAA/GLBA). Have counsel finalize before an actual incident occurs — not during one.*
