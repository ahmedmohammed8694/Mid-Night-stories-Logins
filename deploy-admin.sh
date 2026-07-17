#!/bin/bash
# deploy-admin.sh - Deploy the admin panel to Cloudflare Workers

set -e

echo "🚀 Deploying Midnight Stories Admin Panel..."

# Navigate to admin directory
cd "$(dirname "$0")/admin"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Set JWT secret if not already set
echo "🔐 Ensure ADMIN_JWT_SECRET is set in Cloudflare..."
echo "Run: cd admin && wrangler secret put ADMIN_JWT_SECRET"

# Deploy
echo "🌐 Deploying to admin.midnightstories.dpdns.org..."
wrangler deploy

echo "✅ Admin panel deployed!"
echo "🌍 Admin URL: https://admin.midnightstories.dpdns.org/"