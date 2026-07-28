# Midnight Stories — Product Overview

## Purpose
Anonymous life stories sharing platform where users can submit, read, and engage with personal stories safely and anonymously. Also includes a digital book library with EPUB/PDF reader, community chat, and a full support ticketing system.

## Key Features

### Stories Platform
- Anonymous story submission with token-based identity (no account required)
- Story categories: Childhood, Family, Loss & Grief, Recovery, Relationships, Mental Health, Identity, Triumph, LGBTQ+, etc.
- Like, comment, and follow system
- Content moderation queue (pending → approved/rejected/removed)

### Book Library
- EPUB and PDF reader with bookmarks, highlights, and reading progress sync
- Two content channels: **Education** (general books) and **Navel** (maritime/naval studies)
- User book submissions with admin approval workflow
- Personal library shelves: want_to_read, currently_reading, finished

### User Accounts
- Email/password and Google OAuth registration
- Profile with privacy controls (show/hide phone, email)
- Account statuses: active, suspended, banned, shadowbanned
- DM permissions and interaction controls (like, comment, follow, block)

### Admin Panel (separate Cloudflare Worker)
- Story and comment moderation
- User management with warnings (first_warning, second_warning, final_notice)
- IP/fingerprint banning
- Book approval workflow
- Support ticket management with SLA rules

### Support Ticketing System
- Full helpdesk with categories: Content Moderation, Book Library, Account & Access, Billing, Technical Bugs, Feature Requests
- Ticket messages, attachments, audit logs, canned responses
- SLA rules by priority (urgent: 1h FRT / 4h TTR, down to low: 24h / 72h)
- Ticket ratings (1–5 stars)

### Community
- Real-time chat rooms
- Notifications system
- Admin-to-user messaging

## Target Users
- General public seeking anonymous story sharing
- Readers looking for free EPUB/PDF books (education + naval focus)
- Admins/moderators managing content and support

## Deployment
- Cloudflare Pages (frontend static files from `public/`)
- Cloudflare Workers (serverless API via `src/worker.js`)
- Cloudflare D1 (SQLite database: `midnight-stories-login-db`)
- Cloudflare R2 (image/file storage: `midnight-stories-images`)
