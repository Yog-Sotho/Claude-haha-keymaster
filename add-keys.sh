# Add Nvidia NIM key (free tier: 40 req/min)
curl -X POST http://localhost:8082/admin/add-key \
  -H "Authorization: Bearer your_admin_token" \
  -H "Content-Type: application/json" \
  -d '{"provider": "nvidia", "api_key": "nvapi-xxx"}'

# Add OpenRouter key (free tier: ~20 req/min)
curl -X POST http://localhost:8082/admin/add-key \
  -H "Authorization: Bearer your_admin_token" \
  -H "Content-Type: application/json" \
  -d '{"provider": "openrouter", "api_key": "sk-or-v1-xxx"}'