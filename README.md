# Midnight Stories — Cloudflare Pages Migration

This repository is configured to deploy to **Cloudflare Pages** with serverless backend APIs (Pages Functions) and a serverless **Cloudflare D1 SQL** database.

## 🛠️ Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Initialize the Local Database
Run the schema script to create and seed the local SQLite database inside the wrangler environment:
```bash
npx wrangler d1 execute midnight-stories-db --local --file=schema.sql
```

### 3. Run the Development Server
```bash
npm run pages:dev
```
Your local server will start at `http://localhost:8788`.

---

## 🌐 Production Deployment

### 1. Create Live D1 Database
Create the production database in Cloudflare:
```bash
npx wrangler d1 create midnight-stories-db
```
Copy the Database ID and paste it in `wrangler.toml` under `database_id`.

### 2. Seed Live Database
Run the schema script against the production database:
```bash
npx wrangler d1 execute midnight-stories-db --remote --file=schema.sql
```

### 3. Create R2 Bucket
Make sure you have created an R2 bucket named `midnight-stories-images` in your Cloudflare dashboard.

### 4. Bind Resources in Cloudflare Pages
After deploying your Pages project:
1. Go to your Pages project in the **Cloudflare Dashboard** ➔ **Settings** ➔ **Functions** ➔ **Compatibility flags** and add `nodejs_compat` to both Production and Preview.
2. Go to **Settings** ➔ **Bindings** ➔ **D1 database bindings** and bind `DB` to the `midnight-stories-db` database.
3. Go to **Settings** ➔ **Bindings** ➔ **R2 bucket bindings** and bind `IMAGES` to the `midnight-stories-images` bucket.

### 5. Deploy Project
Deploy your application directly to Cloudflare:
```bash
npx wrangler pages deploy public --project-name=midnight-stories
```