# Anonymous Life Stories Platform Implementation Plan

This plan details the design and build steps for the **Anonymous Life Stories Platform** — a secure, beautiful, and fully featured web application that allows individuals to share personal stories anonymously. The solution includes a public-facing website, a comprehensive content moderation pipeline (automated & human), and an admin dashboard with multi-factor authentication (MFA) to manage stories, comments, reports, categories, and settings.

To ensure it works out of the box with zero complex setup, we will build a **Node.js & Express** backend using an **SQLite** database (simulating PostgreSQL). The styling will use **Vanilla CSS** with a modern, high-end, responsive dark/light glassmorphic layout.

---

## User Review Required

> [!IMPORTANT]
> **API Services & Local Fallbacks:**
> To make the application immediately runnable and testable locally, we will implement local, high-performance rule-based systems for content safety (image exif-stripping, text PII redaction, keyword filtering, and crisis keyword scanning) and TOTP MFA setup. These will be fully wired to easily connect to production APIs (e.g. OpenAI moderation, AWS Rekognition, Google SafeSearch, Cloudflare Turnstile, AWS S3) via environment variables.

> [!WARNING]
> **MFA Setup for Admin Console:**
> Since this is a public launch website, admin security is crucial. On the first run of the application, the admin credentials will be generated (or configurable), and a TOTP QR code/secret will be shown in the console or admin setup page. You will need a standard authenticator app (e.g., Google Authenticator) to log in.

---

## Open Questions

1. **Default Categories:** We will seed the database with typical categories (`Childhood`, `Family`, `Loss`, `Recovery`, `Relationships`, `Career/School`). Are there any other specific categories you would like to include?
2. **Crisis Resources:** We will embed standard helpline numbers (e.g., 988 Suicide & Crisis Lifeline, Crisis Text Line, Childhelp, National Domestic Violence Hotline). If there is a specific target region or set of resources you prefer, please let us know.

---

## Proposed Changes

We will create the following files within the workspace `d:\My Applications\Webside`.

### Backend & Database Foundations

#### [NEW] [package.json](file:///d:/My%20Applications/Webside/package.json)
Contains NPM dependencies: `express`, `sqlite3`, `multer` (for photo upload handling), `uuid`, `otplib` (for MFA TOTP), `qrcode` (for MFA QR code generation), `bcryptjs` (for password hashing), and development tools.

#### [NEW] [database.js](file:///d:/My%20Applications/Webside/database.js)
Initializes SQLite database and tables (`stories`, `comments`, `categories`, `likes`, `reports`, `moderation_log`, `admin_users`, `banned_identifiers`, `settings`). Seeds default categories, test stories, and the initial admin user.

#### [NEW] [moderation.js](file:///d:/My%20Applications/Webside/moderation.js)
Handles automated content classification:
* Text scanner: PII scrub (emails, phone numbers, SSNs, credit cards), crisis language detection (suicidal ideation/self-harm keywords), and banned toxicity keyword checklist.
* Image processor: Strips EXIF metadata, resizes images to standard safe web formats, and simulates safety validation (nudity/violence detection).

#### [NEW] [server.js](file:///d:/My%20Applications/Webside/server.js)
The core application entry point. Implements APIs for:
* Public actions: List/view stories, submit story (with files), add comment, add like, report story/comment, fetch categories, and fetch crisis resources.
* Admin actions: Login, MFA verification, manage queues (pending stories, flagged images, user reports), update static pages, modify settings (abuse rules, banned keywords), and retrieve audit logs & analytics.
* Security middleware: IP rate limiter, Turnstile/CAPTCHA simulation, input sanitizer.

---

### Public Frontend Pages

#### [NEW] [public/css/style.css](file:///d:/My%20Applications/Webside/public/css/style.css)
The unified styling file. Uses modern typography (Inter/Outfit fonts), rich gradients, a default dark glassmorphic theme with a light mode toggle, responsive layouts (flex/grid), smooth micro-animations for hover states, and premium-looking UI cards.

#### [NEW] [public/index.html](file:///d:/My%20Applications/Webside/public/index.html)
The home page layout. Contains the story browsing interface (filter by category, sort by Newest/Most Liked/Most Discussed), search bar, quick guidelines alert, theme switcher, and links to submission and static pages.

#### [NEW] [public/submit.html](file:///d:/My%20Applications/Webside/public/submit.html)
The story submission page. Contains the anonymous submission form, category selector, optional photo drop zone, age declaration, live character/word counters, client-side PII warnings, and the crisis helper alert modal.

#### [NEW] [public/story.html](file:///d:/My%20Applications/Webside/public/story.html)
The single story detail view. Displays the full story text, optional image, comment thread (with nested replies design), share sheet (copy link, social templates), report dialog, and a quick-like button.

#### [NEW] [public/resources.html](file:///d:/My%20Applications/Webside/public/resources.html)
Interactive crisis resource directory. Provides categories of help (Mental Health, Abuse, Youth, Addiction) with contact details, direct dial links, and guidance on how to find immediate assistance.

#### [NEW] [public/about.html](file:///d:/My%20Applications/Webside/public/about.html)
#### [NEW] [public/terms.html](file:///d:/My%20Applications/Webside/public/terms.html)
#### [NEW] [public/privacy.html](file:///d:/My%20Applications/Webside/public/privacy.html)
#### [NEW] [public/guidelines.html](file:///d:/My%20Applications/Webside/public/guidelines.html)
Static informational and legal compliance pages with links displayed in the website footer.

---

### Admin Frontend Console

#### [NEW] [public/admin.html](file:///d:/My%20Applications/Webside/public/admin.html)
A secure admin dashboard layout containing multiple panels:
1. **Analytics Hub:** Visual statistics of submissions, moderation counts, queue size, and system health.
2. **Moderation Queue:** Table of pending stories and comments with quick action buttons (Approve, Reject, Edit, Ban IP).
3. **Image Review Grid:** Visual grid of pending photo uploads with safe preview and automated scan logs.
4. **Report Queue:** Details of flagged content with reporter comments, counts, and resolution toggles.
5. **Abuse & Settings Panel:** Controls to update the banned keyword list, customize rate limits, and block IPs.
6. **Audit & Log Panel:** Chronological record of administrative operations.

---

### Scripts & Logic Integration

#### [NEW] [public/js/app.js](file:///d:/My%20Applications/Webside/public/js/app.js)
Shared helper utilities (API requests, theme management, shared templates, and notification toast manager).

#### [NEW] [public/js/feed.js](file:///d:/My%20Applications/Webside/public/js/feed.js)
Orchestrates browsing, searching, and updating the story grid on `index.html`.

#### [NEW] [public/js/story.js](file:///d:/My%20Applications/Webside/public/js/story.js)
Coordinates comment posting, story/comment likes, and submitting reports on `story.html`.

#### [NEW] [public/js/submit.js](file:///d:/My%20Applications/Webside/public/js/submit.js)
Applies PII warnings in real-time as the user types, intercepts crisis triggers to show safety cards, handles files, and posts submissions.

#### [NEW] [public/js/admin.js](file:///d:/My%20Applications/Webside/public/js/admin.js)
Powers the admin login, TOTP verification, page panels switching, and data updates.

---

## Verification Plan

### Automated Tests
To confirm backend APIs work correctly and return correct statuses (e.g. rate-limits, validation blocks, PII triggers, like validations), we will write a validation script:
- Run `node test_api.js` to execute automated API integration checks covering submission, commenting, liking, reporting, and admin login validation.

### Manual Verification
We will use the **browser subagent** to perform end-to-end user-flow validation:
1. **Browse Feed:** Verify stories load, filter by category works, and theme toggle switches styles.
2. **Submit a Story:** Test submitting a valid story, triggering the crisis intervention warning, triggering the PII checker warning, and uploading an image.
3. **Interactive Actions:** Click like (verify it restricts double liking), post comments, and report a post.
4. **Admin Dashboard:** Log in as admin, enter the MFA setup code, view the statistics, approve/reject a pending story, and check the audit logs.
