#!/bin/bash
# Clean Next.js build cache and rebuild

echo "🧹 Cleaning Next.js cache..."
rm -rf .next
rm -rf node_modules/.cache
rm -rf .turbo

echo "📦 Rebuilding..."
pnpm run build

echo "✅ Done!"

