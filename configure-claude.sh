cd /path/to/claude-code-haha
echo "ANTHROPIC_BASE_URL=http://localhost:8082" >> .env
echo "ANTHROPIC_AUTH_TOKEN=dummy" >> .env # Keymaster manages keys
./bin/claude-haha