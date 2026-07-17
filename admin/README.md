# Midnight Stories Admin Panel

A dedicated admin panel for the Midnight Stories platform, deployed to a separate subdomain:
`https://admin.midnightstories.dpdns.org/`

## Features

- **Separate Admin Subdomain**: The admin panel runs on its own Cloudflare Worker subdomain
- **Shared Database**: Connects to the same Cloudflare D1 database as the public site
- **Admin Authentication**: JWT-based with optional MFA (TOTP)
- **Moderation Queues**: Approve/reject stories and comments
- **Reports Management**: Review and resolve user reports
- **Category Management**: Create, view, and delete story categories
- **Ban Management**: Ban/unban IP hashes
- **Settings**: Configure rate limits, approval requirements, banned keywords
- **Audit Log**: Track all administrative actions
- **User Management**: View and delete registered users
- **Dashboard Stats**: Overview of platform metrics

## Architecture

```
admin/
├── wrangler.toml          # Cloudflare Worker config (admin subdomain)
├── package.json           # Worker dependencies
├── src/
│   └── worker.js          # Admin Worker (Hono) — all admin API routes
└── public/
    ├── index.html         # Admin dashboard UI
    ├── css/
    │   └── admin.css       # Admin-specific styles
    ├── js/
    │   ├── app.js          # Shared utilities (api, toast, etc.)
    │   └── admin.js        # Admin dashboard logic
    └── favicon.svg
```

## Prerequisites

- Cloudflare account with Wrangler CLI installed
- The same D1 database as the public site (`midnight-stories-login-db`)
- Node.js 18+

## Setup

```bash
# Install dependencies
cd admin
npm install

# Login to Cloudflare
wrangler login

# Set the JWT secret (used for admin session tokens)
wrangler secret put ADMIN_JWT_SECRET
# Enter a secure random string, e.g.: openssl rand -hex 32
```

## Deploy

```bash
# Deploy to Cloudflare Workers
wrangler deploy

# Or run locally for testing
wrangler dev
```

The worker will be available at:
- Production: `https://admin.midnightstories.dpdns.org/`
- Local dev: `http://localhost:8787/`

## DNS Configuration

Make sure the following DNS record exists in your Cloudflare zone (`dpdns.org`):

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | admin | your-worker-subdomain.workers.dev | Proxied (orange cloud) |

Or, if using a route in wrangler.toml, ensure the route `admin.midnightstories.dpdns.org/*` is assigned to this worker.

## Admin Credentials

The default admin account is seeded in the shared D1 database:

- **Username**: `admin`
- **Password**: `Admin@2026!`
- **MFA Secret**: Printed in the server logs on first database initialization

> ⚠️ **IMPORTANT**: Change the default password immediately after first login via the settings or by updating the database directly.

## API Endpoints

All endpoints are under `/api/admin/*` and require a valid admin JWT token (except `/api/admin/login` and `/api/admin/mfa-verify`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/login` | Admin login (returns JWT or MFA pre-token) |
| POST | `/api/admin/mfa-verify` | Verify MFA code |
| POST | `/api/admin/mfa-setup` | Get MFA QR code and secret |
| POST | `/api/admin/mfa-enable` | Enable MFA for current admin |
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/queue` | Moderation queue (stories/comments) |
| POST | `/api/admin/moderate` | Approve/reject/remove content |
| GET | `/api/admin/reports` | List reports |
| POST | `/api/admin/reports/:id/resolve` | Resolve a report |
| GET | `/api/admin/categories` | List categories |
| POST | `/api/admin/categories` | Create category |
| DELETE | `/api/admin/categories/:id` | Delete category |
| GET | `/api/admin/bans` | List bans |
| POST | `/api/admin/ban` | Create ban |
| DELETE | `/api/admin/bans/:id` | Remove ban |
| GET | `/api/admin/audit-log` | Audit log |
| GET | `/api/admin/settings` | Get settings |
| PUT | `/api/admin/settings` | Update settings |
| GET | `/api/admin/users` | List users |
| DELETE | `/api/admin/users/:id` | Delete user |

## Security Notes

- All admin routes are protected by `requireAdmin` middleware (JWT verification)
- CORS is configured to allow only the admin subdomain and localhost origins
- The admin panel HTML includes `<meta name="robots" content="noindex, nofollow">` to prevent search engine indexing
- Admin sessions expire after 8 hours
- MFA pre-tokens expire after 5 minutes

## Connecting to the Database

The admin worker connects to the **same D1 database** as the public site via the `DB` binding in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "midnight-stories-login-db"
database_id = "48095d8e-c182-4ba3-a285-81eddbc3beb9"
```

This means all moderation actions performed in the admin panel immediately affect the public site.
