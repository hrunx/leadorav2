#!/bin/bash

echo "🧪 Testing Netlify Functions..."
echo "================================="

BASE_URL="http://localhost:8888/.netlify/functions"

echo ""
echo "1. 🔧 Testing basic function..."
curl -s "$BASE_URL/test-simple" | jq '.' || echo "❌ test-simple failed"

echo ""
echo "2. 🏥 Testing system health..."
curl -s "$BASE_URL/test-full-system" | jq '.' || echo "❌ test-full-system failed"

echo ""
echo "3. 📊 Testing progress check (should error with invalid UUID)..."
curl -s -X POST "$BASE_URL/check-progress" \
  -H "Content-Type: application/json" \
  -d '{"search_id":"test"}' | jq '.' || echo "❌ check-progress failed"

echo ""
echo "4. 📈 Testing API logs..."
curl -s "$BASE_URL/check-api-logs" | jq '.' || echo "❌ check-api-logs failed"

echo ""
echo "5. 🤖 Testing individual agents..."
curl -s -X POST "$BASE_URL/test-individual-agents" | jq '.' || echo "❌ test-individual-agents failed"

echo ""
echo "✅ Function testing complete!"
echo ""
echo "🌐 Now test the frontend at: http://localhost:8888"
echo ""
echo "📋 Follow the comprehensive test plan in test-netlify-dev.md"