# Tech Stack Summary

> **Target Project:** Midnight Stories (`midnight-stories`)  
> **Primary Audience:** Developers  
> **Document Status:** Complete

---

## 1. System Architecture Layers

The platform runs serverlessly at the edge, leveraging Cloudflare Pages and Workers. Below is the breakdown of technical layers and dependencies:

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

## 2. Cloudflare Wrangler Configurations

The deployment topology is managed through `wrangler.toml` with the following configuration and bindings:

```toml
# wrangler.toml — Cloudflare Workers + Assets configuration for Midnight Stories
name = "mid-night-stories-logins"
main = "src/worker.js"
compatibility_date = "2026-07-15"
compatibility_flags = ["nodejs_compat"]

# Static Assets Configuration
[assets]
directory = "public"
binding = "ASSETS"
run_worker_first = true

# Cloudflare D1 SQLite Database Binding
[[d1_databases]]
binding = "DB"
database_name = "midnight-stories-login-db"
database_id = "48095d8e-c182-4ba3-a285-81eddbc3beb9"

# Cloudflare R2 Object Storage Binding
[[r2_buckets]]
binding = "IMAGES"
bucket_name = "midnight-stories-images"
```

### Key Bindings
* **D1 SQL Database (`DB`):** Holds application relational tables, user auth logs, ticket histories, and audit records.
* **R2 Storage (`IMAGES`):** Holds uploaded binary avatars and custom book cover graphics.
* **Assets Server (`ASSETS`):** Handles static caching and edge routing of web pages from the `public/` directory.
* **`nodejs_compat` Flag:** Enables runtime APIs on the V8 engine for compatibility with standard cryptographic and hashing helper tools (e.g. `bcrypt` hashing).
