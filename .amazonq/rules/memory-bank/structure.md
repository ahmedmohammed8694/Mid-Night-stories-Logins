# Midnight Stories — Project Structure

## Root Directory Layout

```
midnight-stories/
├── src/
│   ├── worker.js          # Main Cloudflare Worker — all API routes (Hono)
│   └── moderation.js      # Moderation helper utilities
├── functions/
│   ├── api/[[route]].js   # Cloudflare Pages Functions catch-all route (legacy/alt)
│   ├── uploads/[filename].js  # R2 file serving handler
│   └── moderation.js      # Pages Functions moderation middleware
├── public/                # Static frontend (served by Cloudflare Pages)
│   ├── index.html         # Home / story feed
│   ├── stories.html       # Stories listing
│   ├── story.html         # Single story view
│   ├── submit.html        # Anonymous story submission
│   ├── books.html         # Book library listing
│   ├── library.html       # User personal library
│   ├── reader.html        # EPUB/PDF reader
│   ├── upload-book.html   # User book submission
│   ├── chat.html          # Community chat
│   ├── support.html       # Support ticket system
│   ├── profile.html       # User profile
│   ├── login.html / signup.html
│   ├── admin.html         # Admin panel (main app)
│   ├── about.html / guidelines.html / privacy.html / terms.html
│   ├── css/               # Stylesheets per page
│   ├── js/                # Page-specific JS modules
│   │   ├── app.js         # Auth, shared utilities, API client
│   │   ├── feed.js        # Story feed logic
│   │   ├── stories.js     # Stories page
│   │   ├── story.js       # Single story + comments
│   │   ├── submit.js      # Story submission form
│   │   ├── books.js       # Book library browsing
│   │   ├── library.js     # Personal library shelves
│   │   ├── reader.js      # EPUB.js / PDF reader
│   │   ├── support.js     # Ticket creation & management
│   │   └── admin.js       # Admin panel JS
│   └── images/            # Static images/assets
├── admin/                 # Separate Cloudflare Worker for admin panel
│   ├── src/worker.js      # Admin API Worker (Hono)
│   ├── public/            # Admin static frontend
│   └── wrangler.toml      # Admin worker config
├── migrations/            # Incremental D1 SQL migrations (001–006)
├── scratch/               # One-off scripts, seed data, utilities (not deployed)
├── SEO Files/             # SEO audit CSVs, Excel reports
├── data/
│   └── stories.db         # Local SQLite dev database
├── schema.sql             # Full D1 schema (drop + recreate + seed)
├── database.js            # Local Express server DB helper
├── server.js              # Local Express dev server
├── wrangler.toml          # Main Worker config (D1 + R2 bindings)
└── package.json
```

## Core Components & Relationships

### API Layer (`src/worker.js`)
- Single Cloudflare Worker using **Hono** framework
- Handles all `/api/*` routes: auth, stories, comments, likes, books, library, chat, support tickets, admin
- Binds to `DB` (D1) and `IMAGES` (R2) via `wrangler.toml`
- Static assets served from `public/` via `ASSETS` binding with `run_worker_first = true`

### Frontend (`public/`)
- Vanilla HTML/CSS/JS — no frontend framework
- Each page has a corresponding JS file in `public/js/`
- `app.js` is the shared module: handles JWT auth, API fetch wrapper, user state
- Pages communicate with the Worker API via `fetch('/api/...')`

### Admin Panel (`admin/`)
- Separate Cloudflare Worker deployment
- Own `wrangler.toml`, own `src/worker.js`, own static frontend
- Connects to the same D1 database

### Database (`schema.sql` + `migrations/`)
- `schema.sql` = full destructive reset (used for fresh init)
- `migrations/001–006.sql` = incremental changes for production upgrades
- D1 binding name: `DB`

## Architectural Patterns
- **Serverless-first**: No persistent server; all logic in Cloudflare Workers
- **Token-based anonymous identity**: Stories use `submitter_token` (not user accounts)
- **IP hashing**: IPs stored as hashes for privacy (`ip_hash` columns)
- **Dual-channel content**: `channel_type` field (`education` / `navel`) separates book categories
- **Status-gated content**: Stories and books go through pending → approved workflow before public visibility
- **SLA-driven ticketing**: Support tickets have priority-based FRT/TTR deadlines
