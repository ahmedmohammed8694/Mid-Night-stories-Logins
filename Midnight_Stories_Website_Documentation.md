# Midnight Stories — Technical Documentation & Comprehensive Site Audit

> **Document Type:** Full System Architecture, Page Inventory & Asset Audit  
> **Target Project:** Midnight Stories (`midnight-stories`)  
> **Platform Description:** Anonymous Life Stories & Digital Library Platform  
> **Date of Audit:** August 6, 2026  
> **Workspace Path:** `D:\My Applications\Midnigth stories`  
> **Document Version:** 2.0 (Zero-Trust Security & RBAC Release)

---

## Executive Summary

This document presents an exhaustive deep-dive audit and structural specification for **Midnight Stories**, an anonymous personal story publishing platform, helpdesk ticketing desk, and public-domain digital reader. Built on **Cloudflare Pages** with **Hono serverless APIs** (running on Cloudflare Workers) and **Cloudflare D1 (SQLite)** database bindings, the application incorporates strict privacy controls, automated moderation, role-based access control (RBAC), and real-time crisis support.

---

## 1. System Overview & Core Stack Architecture

The application is structured to run serverlessly on Cloudflare's edge platform. The static frontend is served via Cloudflare Assets, while dynamic routes and API logic are executed in a single high-performance worker.

| Layer | Technology | Primary Package / File | Purpose & Operational Role |
|---|---|---|---|
| **Frontend UI** | HTML5 + Modern Vanilla JS | `public/*.html`, `public/js/*.js` | Responsive client application rendering with zero build step dependencies. |
| **Design System** | CSS3 Custom Properties Token System | `public/css/style.css`, `admin.css`, `reader.css` | Glassmorphism, page-themed backgrounds, WCAG AA contrast colors. |
| **Typography** | Google Fonts API | `Inter` & `Fraunces` via `style.css` | High readability serif for stories/books (`Fraunces`) and clean UI sans (`Inter`). |
| **Backend API** | Hono Framework v4.4.2 | `src/worker.js` | Edge-deployed serverless REST API running on Cloudflare Workers. |
| **Database Engine** | Cloudflare D1 (SQLite) | `schema.sql`, `database.js` | Serverless relational database for users, stories, books, tickets, and audits. |
| **Image Storage** | Cloudflare R2 Storage | `wrangler.toml` (`IMAGES`) | Object storage for user-uploaded book covers and avatars. |
| **Authentication** | JWT + TOTP 2FA + OAuth | `bcryptjs`, `otplib`, `qrcode` | Secure session tokens, Google OAuth 2.0 login, and 2-factor authentication. |
| **E2E Testing** | Playwright Test Suite | `playwright.config.js` | Automated end-to-end integration and UI workflow verification. |

---

## 2. Team & Support Ownership

* **Moderation Team:** Responsible for reviewing pending user story submissions, evaluating flagged comments, and managing the content pipeline.
* **Technical Team:** Responsible for monitoring system performance, managing Cloudflare deployments, maintaining database integrity, and applying security upgrades.
* **Support Desk:** Responsible for managing user support tickets, resolving account issues, and updating crisis resources.
* **Official Contact Channel:** `support@midnightstories.dpdns.org` (operational response SLA is under 24 hours).

---

## 3. Product Goals & Stated Features

Midnight Stories is designed to solve the problem of digital isolation and trauma-sharing by offering:
1. **100% Anonymous story publishing option:** Anyone can submit stories without creating an account. Submissions generate a unique private token, allowing the submitter to edit or delete the post later without revealing their identity.
2. **Distraction-Free Digital Library:** Public domain and user-submitted books are categorized and readable via an e-reader layout with adjustable sizes and light/sepia/dark themes.
3. **Safe Peer-Support Community:** Interactions (likes, comments, following) are allowed under nickname pseudonyms. Toxic content and personal identifiers are blocked via automated check gates.
4. **Crisis Support Intervention:** A banner and dedicated directory map local helplines. Real-time content scans detect language patterns indicating crisis and trigger immediate warning interventions.

---

## 4. Hierarchical Information Architecture (Sitemap)

The site features **27 HTML pages** organized in the folder hierarchy below:

```
public/
├── index.html (Core Experience Landing & Feed)
├── about.html (Platform Mission, Features, and Policies)
├── guidelines.html (Community Code of Conduct)
├── stories.html (Story Feed Explorer)
├── story.html (Individual Story View & Comments)
├── submit.html (Anonymous Story Editor)
├── books.html (Book Library Catalog)
├── library.html (Personal Dashboard & Bookmarks)
├── reader.html (Distraction-Free E-Reader)
├── upload-book.html (Book Contributor Tool)
├── login.html (Standard Sign-in & Google OAuth)
├── signup.html (User Registration)
├── forgot-password.html (3-Step Account Recovery)
├── profile.html (User Settings & 2FA Setup)
├── support.html (Crisis Support & Helpdesk Ticketing)
├── chat.html (Real-time Support Chat)
├── resources.html (Mental Health Helplines Directory)
├── admin.html (Administrative Console Dashboard)
├── privacy.html (Privacy Policy)
├── terms.html (Terms of Service)
├── copyright.html (DMCA & Copyright Policy)
├── disclaimer.html (Mental Health Legal Disclaimer)
├── cookie-policy.html (Strictly Necessary Cookies Policy)
├── accessibility.html (WCAG AA Compliance Statement)
├── refund-policy.html (Donation & Refund Statement)
├── hash.html (Offline bcrypt Generator Utility)
└── admin/
    └── employees.html (Employee & RBAC Roster Desk)
```

### Page Inventory Detail

| Page Path | H1 Heading / Core Purpose | Forms & Inputs | Client JS | Theme Background Asset |
|---|---|---|---|---|
| `index.html` | Share Your Story Anonymously | Quick search, category filters | `app.js`, `feed.js` | `home_theme_bg.png` |
| `about.html` | About Our Creative Writing Platform | Newsletter subscription | `app.js` | `about_page_bg_1785635971812.png` |
| `guidelines.html` | Community Safety Standards | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `stories.html` | Explore Anonymous Stories | Search input, sort/filter pills | `feed.js`, `stories.js` | `stories_page_bg_1785635941629.png` |
| `story.html` | Story Reader | Comment editor, reply boxes, report dialog | `story.js` | `story_page_bg_1785635998903.png` |
| `submit.html` | Submit Your Story | Title, story body, category, tags, cover upload | `submit.js` | `upload_page_bg_1785636009900.png` |
| `books.html` | Public Domain Book Library | Book search query, category, sort dropdown | `books.js` | `books_theme_bg.png` |
| `library.html` | My Personal Library | Library search input, shelf filters | `library.js` | `library_page_bg_1785636028634.png` |
| `reader.html` | Midnight Reader | Chapter select, font size slider, e-theme toggles | `reader.js` | `reader_page_bg_1785635981060.png` |
| `upload-book.html` | Upload New Book | Title, author, description, book file, cover file | `books.js` | `upload_page_bg_1785636009900.png` |
| `login.html` | Welcome Back | Email, password, 2FA validation token | `app.js` | `login_theme_bg.png` |
| `signup.html` | Join Midnight Stories | Full name, email, password, DOB, phone | `app.js` | `signup_theme_bg.png` |
| `forgot-password.html`| Reset Password | Step 1 email, Step 2 OTP, Step 3 new password | `app.js` | `auth_theme_bg.png` |
| `profile.html` | User Profile & Settings | Name, bio, avatar select, phone privacy, 2FA toggle | `app.js` | `profile_page_bg_1785636037845.png` |
| `support.html` | Crisis Support & Help Desk | Ticket category, priority, subject, description, file | `support.js` | `support_page_bg_1785636054161.png` |
| `chat.html` | Live Support Chat | Chat input, upload button | `support.js` | `support_page_bg_1785636054161.png` |
| `resources.html` | Crisis Support Resources | None (Interactive Helpline cards) | `app.js` | `resources_page_bg_1785635950351.png` |
| `admin.html` | Administrative Console | Login email/password/MFA, review selectors, settings | `admin.js` | N/A (Admin Surface) |
| `admin/employees.html`| Employee Management & RBAC | Provision employee modal, documents upload, status toggle | Inline JS | N/A (Admin Surface) |
| `privacy.html` | Privacy Policy | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `terms.html` | Terms of Service | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `copyright.html` | Copyright & DMCA Policy | Infringement signature, work link, description | `app.js` | `about_page_bg_1785635971812.png` |
| `disclaimer.html` | Mental Health Disclaimer | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `cookie-policy.html` | Cookie Policy | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `accessibility.html` | Accessibility Statement | Feedback name, email, and statement | `app.js` | `about_page_bg_1785635971812.png` |
| `refund-policy.html` | Refund Policy | None (Informational) | `app.js` | `about_page_bg_1785635971812.png` |
| `hash.html` | Password Hashing Utility | String input, output bcrypt field | Inline JS | N/A (Utility) |

---

## 5. Design System & Style Guide

Midnight Stories runs on a unified CSS custom property token system declared in `public/css/style.css`. It features smooth 3D cards, glassmorphic surfaces, and dedicated dark and light mode themes.

```css
/* Typography Fonts */
--font-primary: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-display: 'Fraunces', Georgia, serif;

/* Radii Tokens */
--radius-sm: 6px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 24px;
--radius-full: 9999px;

/* Shadow Tokens */
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.45);
--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.45);
--shadow-lg: 0 10px 32px rgba(0, 0, 0, 0.55);
--shadow-xl: 0 20px 56px rgba(0, 0, 0, 0.65);
--shadow-glow: 0 0 28px var(--page-accent-glow);
```

### Color Palette Matrix

| Token Name | Light Mode (Warm Book Theme) | Dark Mode (Midnight Theme) | UI Role / Usage |
|---|---|---|---|
| `--ms-bg` | `#FAF6EE` (Warm Cream) | `#070914` (Deep Midnight Blue) | Global Page Background |
| `--ms-surface` | `#FFFFFF` (Pure White) | `rgba(15, 23, 42, 0.72)` (Translucent Slate) | Cards, Modals, Headers |
| `--ms-border` | `#E6DFD3` (Soft Warm Gray) | `rgba(255, 255, 255, 0.12)` (Translucent Line) | Dividers and Card Borders |
| `--ms-text` | `#1A202C` (Off-black) | `#F1EDE4` (Warm Chalk) | Heading & Primary Body Text |
| `--ms-text-secondary`| `#4A5568` (Slate Gray) | `#9CA3BE` (Muted Indigo Gray) | Metadata and Secondary Info |
| `--ms-text-muted` | `#718096` (Cool Gray) | `#6B7290` (Dark Slate Gray) | Inactive labels, Placeholders |
| `--ms-accent` | `#801D2C` (Deep Crimson) | `#F59E0B` (Candlelight Amber Gold) | Primary Buttons, Active States |
| `--accent-rose` | `#C53030` | `#F87171` | Danger state / Destructive Buttons |
| `--accent-emerald` | `#2F855A` | `#34D399` | Success state / Active verification |
| `--accent-amber` | `#C05621` | `#FBBF24` | Warning state / Pending alerts |

---

## 6. Functional Specification

### 6.1 Content Moderation & Crisis Warning Pipeline
The platform implements a multi-tiered filtering system defined in `src/moderation.js`:
* **PII Filter:** Regular expressions scan submissions for emails, phone numbers, SSNs, and credit cards. Found inputs trigger warnings.
* **Toxicity Filter:** Submissions are checked against a banned keywords checklist.
* **Crisis Scanner:** Specific keyword groupings (relating to self-harm, depression, or abuse) flag submissions. Triggering words show an immediate modal pointing to the Crisis helplines directory before saving.
* **Image Safety:** Uploaded cover artwork is stripped of EXIF coordinates/metadata and checked for file signature headers (magic bytes) to prevent executable injection.

### 6.2 Token-Based Anonymous Management
When writing a story anonymously, a unique UUID token (`submitter_token`) is stored in the database and provided to the client. This token acts as a password key, letting the author modify or remove their post directly without revealing their identity.

### 6.3 E-Reader Configurations
The book reader module (`reader.js`) handles client reading settings. Page configurations (font size from 12px to 28px, background themes sepia/dark/light, chapter positioning) are saved to browser `localStorage` to keep the user's progress offline.

---

## 7. Cloudflare Infrastructure & Bindings

The application wrangler environment (`wrangler.toml`) utilizes:
1. **D1 Relational SQL Database Binding (`DB`):** Holds the application schemas, user profiles, and audit log events.
2. **R2 Object Storage Binding (`IMAGES`):** Holds binary user avatar files and book cover images.
3. **Assets Server Binding (`ASSETS`):** Handles edge-caching and routing static content from `public/`.
4. **Compatibility flag (`nodejs_compat`):** Required to run standard Node modules like `bcrypt` and encryption services on V8 serverless environments.

---

## 8. Role-Based Access Control (RBAC) & Zero-Trust Portal Security

The administration console uses Zero-Trust security rules to verify requests before database actions occur. Hardcoded checks have been transitioned to positive capability checks.

### Role Permissions Map

| Role Name | Scope | System Default | Capability List |
|---|---|---|---|
| **Super Admin** | Global | Yes (Locked) | Full administrative control, employee provisioning, role permissions overrides, audit database purges. |
| **Admin** | Account-wide | Yes | Manage user status, review and edit stories/comments, manage settings, read audit logs, upload/approve books. |
| **Agent** | Team-specific | Yes | View support tickets, reply to ticketing conversations, close/reopen tickets, manage assigned cases. |
| **Viewer** | Team-specific | Yes | Read-only analytics dashboard access, view system audits. |

### Immutable Audit Log
Access-sensitive changes (status changes, password resets, bans, role provisioning, file overrides) write details directly to the `audit_log` table. This log records:
* Actor ID and Actor Type (`employee`, `admin`, `system`)
* Triggered Action description
* Target resource Type and ID
* Previous values and New values
* Hashed IP address of the request origin

---

## 9. Legal Policies & Compliance Stack

* **GDPR & CCPA Data Limits:** Hashed IP address logs are auto-deleted after 90 days. User privacy profiles allow opting out of phone and email directory searches.
* **DMCA Notice Portal:** A copyright reporting system (`copyright.html`) provides a structured form to send takedown requests to administrators.
* **A11y Standards:** Commits to WCAG 2.1 AA benchmarks. The accessibility file (`accessibility.html`) lists focus outlines, alternative labels, and text descriptions.

---

## 10. Database Schema Matrix

The Cloudflare D1 instance contains **50 tables** defined in `schema.sql`. Below is the complete matrix of active database tables.

| Table Name | Primary Key | Key Columns | System Dependency / Purpose |
|---|---|---|---|
| `users` | `id` | `user_id`, `email`, `password_hash`, `account_status`, `dm_permission`, `interaction_permissions` | Core user directory, auth states, and profile metadata. |
| `accounts` | `id` | `name`, `domain`, `status` | Tenant organization accounts. |
| `teams` | `id` | `name`, `account_id`, `status` | Moderator teams and support groups routing. |
| `password_resets` | `email` | `otp`, `expires_at`, `attempts` | Stores temporary codes for secure recovery flows. |
| `categories` | `id` | `name`, `slug`, `channel_type`, `parent_id` | Categories tree for stories and books. |
| `ticket_categories` | `id` | `name`, `description`, `default_sla_id`, `default_priority`, `default_team_id`, `status` | Ticket categories and SLA routing rules. |
| `ticket_subcategories`| `id` | `category_id`, `name`, `description`, `default_sla_id`, `status` | Subcategories mapping to ticketing groups. |
| `stories` | `id` | `user_id`, `title`, `content`, `category_id`, `image_url`, `status`, `submitter_token`, `ip_hash` | User stories directory. |
| `comments` | `id` | `story_id`, `user_id`, `content`, `status`, `ip_hash` | Story discussion replies. |
| `likes` | `id` | `story_id`, `user_id`, `ip_hash` | Story like counter tracker (forces uniqueness). |
| `reports` | `id` | `user_id`, `ticket_id`, `reported_item_type`, `reported_item_id`, `ticket_status`, `assigned_agent_id` | Core helpdesk ticket and abuse reports register. |
| `ticket_messages` | `id` | `ticket_id`, `sender_id`, `sender_role`, `is_internal`, `message_body` | Ticket messaging thread. |
| `ticket_attachments` | `id` | `ticket_id`, `message_id`, `file_name`, `file_path`, `storage_key` | Ticket file attachments list. |
| `ticket_custom_fields`| `id` | `category_id`, `field_name`, `field_label`, `field_type`, `is_required` | Custom fields schema depending on ticket category. |
| `ticket_ratings` | `id` | `ticket_id`, `user_id`, `rating`, `feedback` | Support experience customer feedback rating. |
| `canned_responses` | `id` | `title`, `content`, `category_id` | Saved responses for quick support agent replies. |
| `ticket_audit_logs` | `id` | `ticket_id`, `actor_id`, `action_type`, `old_value`, `new_value`| Ticket status audit change record. |
| `moderation_log` | `id` | `target_type`, `target_id`, `admin_id`, `action`, `reason` | Content moderator logging audit. |
| `admin_users` | `id` | `username`, `email`, `password_hash`, `mfa_secret`, `mfa_enabled`, `role` | Admin profiles and credentials. |
| `user_warnings` | `id` | `user_id`, `admin_id`, `level`, `template`, `reason` | Record of user policy warnings and violations. |
| `banned_identifiers` | `id` | `identifier` (IP/fingerprint), `type`, `reason`, `expires_at`| Ban list for malicious client identifiers. |
| `settings` | `key` | `value` | Global system settings configuration table. |
| `books` | `id` | `title`, `author`, `file_url`, `file_type`, `status`, `approved_by`, `channel_type` | Library catalog and reader content mappings. |
| `book_categories` | `book_id`, `cat_id`| `book_id`, `category_id` | Map categories to books (many-to-many relationship). |
| `tags` | `id` | `name`, `slug` | General tags taxonomy dictionary. |
| `book_tags` | `book_id`, `tag_id` | `book_id`, `tag_id` | Map tags to books (many-to-many relationship). |
| `reading_progress` | `id` | `user_id`, `book_id`, `location_cfi`, `percent_complete`, `last_read_at` | Tracks reading progress location in ePUB/PDF format. |
| `bookmarks` | `id` | `user_id`, `book_id`, `location_cfi`, `label` | E-Reader reading bookmark placements. |
| `highlights` | `id` | `user_id`, `book_id`, `location_cfi_start`, `location_cfi_end`, `color`, `note_text` | Book text highlight annotations. |
| `user_library` | `user_id`, `book_id`| `shelf_status` | Custom user shelf tracking (Want to read, finished). |
| `user_book_submissions`| `id`| `user_id`, `title`, `author`, `book_file_url`, `status`, `rejection_reason` | Book submission requests from library contributors. |
| `follows` | `id` | `follower_id`, `following_id` | User follower graph. |
| `reads` | `id` | `user_id`, `story_id` | History of read stories. |
| `chat_rooms` | `id` | `name` | Chat rooms directory. |
| `chat_participants` | `id` | `room_id`, `user_id` | Maps users to chat rooms. |
| `chat_messages` | `id` | `room_id`, `sender_id`, `body` | Chat room messages thread. |
| `notifications` | `id` | `user_id`, `type`, `source_id`, `read` | Account event notification messages. |
| `admin_messages` | `id` | `user_id`, `admin_id`, `title`, `body` | direct messages sent to users from administrators. |
| `account_category_access`| `acc_id`, `cat_id` | `enabled` | Tenant category visibility control. |
| `account_subcategory_access`| `acc_id`, `sub_id`| `enabled` | Tenant subcategory visibility control. |
| `team_category_assignments`| `team_id`, `cat_id` | `subcategory_id` | Ticketing auto-routing config mappings. |
| `permissions` | `id` | `code`, `module`, `description` | System permissions database dictionary. |
| `roles` | `id` | `name`, `scope`, `status` | System roles definitions. |
| `role_permissions` | `role_id`, `perm_id` | `effect` (allow/deny) | Permissions assigned to roles. |
| `team_roles` | `team_id`, `role_id` | `is_default` | Roles permitted for teams. |
| `employee_users` | `id` | `account_id`, `team_id`, `role_id`, `full_name`, `email`, `invite_token`, `employment_status` | Provisioned employee roster profiles. |
| `employee_documents` | `id` | `employee_id`, `doc_type`, `file_name`, `file_size`, `storage_url`| Employee uploaded documentation. |
| `employee_permission_overrides`| `id`| `employee_id`, `permission_id`, `effect`, `reason` | Exception permission logs. |
| `audit_log` | `id` | `actor_id`, `actor_type`, `action`, `target_type`, `old_value`, `new_value`, `ip_hash` | Immutable system actions audit log. |

---

## 11. Complete API Route Specification

The dynamic endpoints below are parsed in `src/worker.js`:

### 11.1 Authentication & Session
* `POST /api/auth/signup` - Register a new account.
* `POST /api/auth/login` - Authenticate standard credentials; issues JWT token.
* `GET /api/auth/me` - Validates session and returns current user payload.
* `GET /api/auth/google` - Redirects to Google OAuth 2.0 authorization sequence.
* `GET /api/auth/google/callback` - Verifies Google OAuth parameters and returns JWT token.
* `POST /api/auth/forgot-password` - Requests 2FA recovery OTP.
* `POST /api/auth/verify-otp` - Verifies password reset OTP.
* `POST /api/auth/reset-password` - Resets password with verified OTP.

### 11.2 Stories Discovery & Engagement
* `GET /api/stories` - Lists public stories with category/tag filters.
* `POST /api/stories` - Submits a story; scans content for toxicity and PII.
* `GET /api/stories/:id` - Fetches single story content.
* `POST /api/stories/:id/like` - Toggles like counter for story.
* `POST /api/stories/:id/comments` - Submits comment; checks moderation.
* `DELETE /api/comments/:id` - Allows comments removal by author or admin.

### 11.3 Digital Books & Reader
* `GET /api/books` - Lists approved books with search and genre pills.
* `GET /api/books/:id` - Fetches metadata for individual book.
* `GET /api/books/:id/file` - Downloads binary ePUB/PDF book payload.
* `POST /api/books/:id/progress` - Updates user percent progress and position CFI.

### 11.4 Messaging & User Interactions
* `GET /api/conversations` - Lists user active message rooms.
* `POST /api/conversations` - Starts a messaging channel.
* `POST /api/conversations/:id/accept` - Accepts messaging request.
* `POST /api/conversations/:id/decline` - Rejects messaging request.
* `GET /api/conversations/:id/messages` - Returns messages within conversation.
* `POST /api/messages` - Sends a direct message.
* `DELETE /api/conversations/:id` - Closes chat channel.
* `GET /api/users/search` - Searches user directory.
* `GET /api/users/:idOrUserId` - Returns user profile.
* `PUT /api/users/me` - Updates user profile details.
* `POST /api/users/me/upload` - Saves profile image to R2 bucket.
* `POST /api/users/:id/follow` - Follows user profile.
* `POST /api/users/:id/block` - Blocks user profile.
* `POST /api/users/:id/unblock` - Unblocks user profile.
* `GET /api/users/me/blocked` - Returns list of blocked users.

### 11.5 Helpdesk Ticketing & Support
* `GET /api/user/ticket-categories` - Returns ticket category descriptors.
* `POST /api/user/tickets/create` - Submits a help ticket; uploads attachments to R2.
* `GET /api/users/me/support-inbox` - Fetches user ticket messaging updates.
* `GET /api/crisis-resources` - Returns local emergency services listing.

### 11.6 System Administration & RBAC
* `POST /api/admin/login` - Authenticates admin portal credentials.
* `GET /api/admin/stats` - Returns dashboard data.
* `GET /api/admin/queue` - Lists pending stories/comments moderation pipeline.
* `POST /api/admin/stories` - Admin story moderation command (Approve/Reject).
* `PUT /api/admin/stories/:id` - Edits story content in database.
* `DELETE /api/admin/stories/:id` - Deletes story completely.
* `PUT /api/admin/comments/:id` - Edits comments content.
* `DELETE /api/admin/comments/:id` - Deletes comments from stories.
* `GET /api/admin/users` - Lists registered accounts.
* `PUT /api/admin/users/:id` - Updates user details.
* `DELETE /api/admin/users/:id` - Deletes user account.
* `POST /api/admin/users/:id/status` - Toggles account state (`suspended`, `banned`).
* `POST /api/admin/users/:id/force-unfollow` - Admin force unfollow action.
* `POST /api/admin/users/:id/warn` - Logs a policy warning.
* `GET /api/admin/users/:id/warnings` - Fetches logged warnings list.
* `GET /api/admin/users/:id/relationships` - Returns social graph links.
* `GET /api/admin/users/:id/audit` - Audit log filter for specific user.
* `PUT /api/admin/users/:id/permissions` - Admin updates user permissions.
* `GET /api/admin/categories` - Lists taxonomies.
* `POST /api/admin/categories` - Adds a category.
* `DELETE /api/admin/categories/:id` - Removes a category taxonomy.
* `GET /api/admin/reports` - Lists incoming abuse tickets.
* `POST /api/admin/reports/:id/status` - Updates ticket status.
* `POST /api/admin/reports/:id/reply` - Posts response message to ticket threads.
* `GET /api/admin/reports/aggregated` - Summary dashboard metrics for tickets.
* `GET /api/admin/reports/target` - Reviews reports filtered by target asset.
* `GET /api/admin/bans` - Lists active blockages.
* `POST /api/admin/ban` - Bans IP or fingerprint identifier.
* `DELETE /api/admin/bans/:id` - Lifts ban status.
* `GET /api/admin/canned-responses` - Lists saved response text templates.
* `POST /api/admin/canned-responses` - Creates canned template.
* `GET /api/admin/support-agents` - Lists provisioned ticket agents.
* `GET /api/admin/audit-log` - Returns the general audit event register.
* `POST /api/admin/mfa-setup` - Sets up admin TOTP MFA code.
* `POST /api/admin/mfa-enable` - Activates MFA requirements.
* `POST /api/admin/mfa-verify` - Verifies token authentication for MFA.
* `GET /api/admin/books` - Lists books.
* `GET /api/admin/books/pending` - Lists pending contributor books.
* `POST /api/admin/books` - Creates new book catalog.
* `PUT /api/admin/books/:id` - Updates book information.
* `DELETE /api/admin/books/:id` - Removes book.
* `POST /api/admin/books/bulk-upload` - Parses bulk uploads.
* `POST /api/admin/books/:id/approve` - Approves contributor book.
* `PUT /api/admin/books/:id/status` - Updates book publication state.
* `PATCH /api/admin/books/bulk-update-category` - Modifies categories bulk.
* `PATCH /api/admin/books/bulk-update-status` - Modifies statuses bulk.
* `GET /api/admin/crm-analytics` - CRM analytics data.
* `GET /api/admin/analytics` - System analytics data.
* `GET /api/admin/accounts` - Lists tenant accounts.
* `GET /api/admin/employees` - Lists employee database entries.
* `POST /api/admin/system/purge-expired` - Cleans old logs and temporary tables.
* `GET /api/admin/tax/categories/:id` - Details ticket taxonomy.
* `PUT /api/admin/tax/categories/:id` - Edits category.
* `DELETE /api/admin/tax/categories/:id` - Deletes category.
* `PUT /api/admin/tax/subcategories/:id` - Edits subcategory.
* `DELETE /api/admin/tax/subcategories/:id` - Deletes subcategory.
* `PUT /api/admin/accounts/:id` - Edits tenant account.
* `DELETE /api/admin/accounts/:id` - Deletes account.
* `PUT /api/admin/roles/:id` - Edits role.
* `DELETE /api/admin/roles/:id` - Deletes role.
* `PUT /api/admin/roles/:id/permissions` - Edits permissions.
* `PUT /api/admin/teams/:id` - Edits team.
* `DELETE /api/admin/teams/:id` - Deletes team.
* `PUT /api/admin/employees/:id` - Edits employee.
* `DELETE /api/admin/employees/:id` - Deletes employee.
* `DELETE /api/admin/employees/:id/overrides/:overrideId` - Removes permission overrides.
* `PUT /api/admin/employee-chat/:id/status` - Updates employee availability.

---

## 12. Technical Assumptions

1. **Edge Node compatibility:** The backend is assumed to compile and operate strictly under V8 runtime parameters (Cloudflare Workers) where standard Node API globals are substituted by Cloudflare D1/R2 helper bindings.
2. **Local JWT secrets configuration:** For local testing without wrangler secrets, fallback environment variable checks verify `JWT_SECRET` and `ADMIN_JWT_SECRET` keys and throw clear errors if they are missing.
3. **Database transaction concurrency:** Cloudflare D1 SQLite utilizes transaction isolation checks, assuming serial execution order for high-volume writes.

---

## 13. Versioning & Maintenance Milestones

* **Design system release:** Version 2.0 (August 2, 2026). Incorporates warm-mode typography updates and high-contrast color accessibility fixes.
* **Employee Management Release:** Version 1.0 (July 30, 2026). Launches RBAC dashboard controls (`/admin/employees.html`) and associated styling assets (`admin.css`).
* **Open Database Schema migrations:** Managed via `schema.sql` seeding and automatically processed via Startup Auto-Initialization Middleware to guarantee zero table fragmentation.

---

## 14. Budget & Commercial Model

* **Operational Cost Model:** Open-source platform. Free service tier for public users.
* **Commercialization:** Funded via donation links and volunteer server contributions. All public-domain literary books are delivered with zero ads or paywalls.

---
*Comprehensive technical documentation generated by `website-documentation-generator`.*
