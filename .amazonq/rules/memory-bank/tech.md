# Midnight Stories — Technology Stack

## Runtime & Platform
- **Cloudflare Workers** — serverless JS runtime (V8 isolates), `compatibility_date = "2026-07-15"`
- **Cloudflare Pages** — static frontend hosting with Pages Functions support
- **Cloudflare D1** — SQLite-compatible serverless database (`midnight-stories-login-db`)
- **Cloudflare R2** — S3-compatible object storage for images/books (`midnight-stories-images`)
- `nodejs_compat` flag enabled on all workers

## Languages
- **JavaScript (ES2022+)** — all Worker API code, frontend JS
- **SQL** — D1 schema, migrations, seed data
- **Python** — utility/SEO scripts (`build_updated_seo_excel.py`, `bulk_upload.py`, etc.)
- **HTML/CSS** — vanilla frontend (no framework)

## Core Dependencies

### Main App (`package.json`)
| Package | Version | Purpose |
|---|---|---|
| `hono` | ^4.4.2 | Web framework for Cloudflare Workers |
| `bcryptjs` | ^2.4.3 | Password hashing |
| `better-sqlite3` | ^11.0.0 | Local dev SQLite (server.js only) |
| `express` | ^4.19.2 | Local dev server (server.js only) |
| `otplib` | ^12.0.1 | TOTP/MFA for admin accounts |
| `qrcode` | ^1.5.4 | QR code generation for MFA setup |
| `uuid` | ^9.0.1 | UUID generation |
| `multer` | ^1.4.5-lts.1 | File upload handling (local dev) |
| `wrangler` | ^4.112.0 | Cloudflare CLI (devDependency) |

### Admin Worker (`admin/package.json`)
| Package | Version | Purpose |
|---|---|---|
| `hono` | ^4.4.2 | Web framework |
| `bcryptjs` | ^2.4.3 | Password hashing |
| `otplib` | ^12.0.1 | MFA |
| `qrcode` | ^1.5.4 | MFA QR codes |
| `wrangler` | ^3.60.3 | Cloudflare CLI (devDependency) |

## Frontend Libraries (CDN, no bundler)
- **EPUB.js** — in-browser EPUB reader (`reader.html`)
- Vanilla JS modules loaded per-page (no bundling/transpilation)

## Build & Tooling
- No build step — JS is deployed as-is to Cloudflare Workers
- No frontend bundler (Webpack/Vite/etc.) — plain HTML/JS/CSS
- **Wrangler CLI** — local dev, D1 management, deployment

## Development Commands

### Main App
```bash
npm install                    # Install dependencies
npm run dev                    # Start local Worker dev server (wrangler dev)
npm run deploy                 # Deploy Worker to Cloudflare
npm run db:init                # Apply schema.sql to remote D1
```

### Local Database Setup
```bash
npx wrangler d1 execute midnight-stories-db --local --file=schema.sql
```

### Admin Panel
```bash
cd admin
npm install
npm run dev                    # wrangler dev
npm run dev:local              # wrangler dev --local
npm run deploy                 # wrangler deploy
```

### Pages Deployment (alternative)
```bash
npm run pages:dev              # wrangler pages dev public (port 8788)
npx wrangler pages deploy public --project-name=midnight-stories
```

### D1 Database Management
```bash
# Apply schema to remote
npx wrangler d1 execute midnight-stories-db --remote --file=schema.sql

# Apply a migration
npx wrangler d1 execute midnight-stories-db --remote --file=migrations/006_support_ticket_overhaul.sql
```

## Worker Bindings
| Binding | Type | Name |
|---|---|---|
| `DB` | D1 Database | `midnight-stories-login-db` |
| `IMAGES` | R2 Bucket | `midnight-stories-images` |
| `ASSETS` | Static Assets | `public/` directory |
| `ADMIN_ASSETS` | R2 Bucket | `midnight-stories-admin-assets` (admin only) |

## Deployment URLs
- Main app: Cloudflare Workers (name: `mid-night-stories-logins`)
- Admin panel: `https://admin.midnightstories.dpdns.org/` (name: `midnight-stories-admin`)
