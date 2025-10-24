#!/bin/bash

echo "🔄 Recreating SecureDove Database..."
echo "====================================="

# Check if Turso CLI is installed
if ! command -v turso &> /dev/null; then
    echo "❌ Turso CLI not found. Install it first:"
    echo "npm install -g @tursodatabase/turso-cli"
    exit 1
fi

# Check if logged in
if ! turso auth status &> /dev/null; then
    echo "❌ Not logged in to Turso. Run: turso auth login"
    exit 1
fi

echo "🗑️  Destroying existing database..."
turso db destroy securedove --yes 2>/dev/null || echo "Note: Database may not exist yet"

echo "🆕 Creating new database..."
turso db create securedove

echo "🔑 Creating database token..."
TOKEN=$(turso db tokens create securedove)

echo "📋 Database Information:"
echo "========================"
echo "Database Name: securedove"
echo "Database URL: $(turso db show securedove | grep URL | cut -d' ' -f2)"
echo "Auth Token: $TOKEN"
echo ""

echo "⚠️  IMPORTANT: Update your Vercel environment variables!"
echo "======================================================"
echo "Go to Vercel → Backend Project → Settings → Environment Variables:"
echo ""
echo "TURSO_DATABASE_URL=$(turso db show securedove | grep URL | cut -d' ' -f2)"
echo "TURSO_AUTH_TOKEN=$TOKEN"
echo ""
echo "Then redeploy your backend project."
echo ""
echo "✅ Database recreation complete!"