# 🔑 Claude Haha Keymaster
## Military-Grade API Key & SOCKS Proxy Rotator for Claude Code Haha

[![Bun Version](https://img.shields.io/badge/Bun-1.0+-fbf0df?logo=bun)](https://bun.sh)
[![License: Educational Use](https://img.shields.io/badge/License-Educational_Use-lightgrey)]()
[![Last Updated](https://img.shields.io/badge/Last_Updated-2026--05--20-brightgreen)]()

> ⚠️ **DISCLAIMER**: This project is for educational and research purposes only. It is designed to work with the community-maintained `claude-code-haha` fork of the accidentally leaked Anthropic Claude Code source. We do not endorse or encourage the use of leaked proprietary code. Respect all applicable licenses and terms of service for Anthropic, Nvidia, OpenRouter, and all proxy providers.

---

## 📋 Table of Contents
- [Description](#-description)
- [Core Features](#-core-features)
- [Architecture](#-architecture)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [First Run](#-first-run)
- [Admin API Reference](#-admin-api-reference)
- [Integration with Claude Haha](#-integration-with-claude-haha)
- [Automatic Proxy Sources](#-automatic-proxy-sources)
- [Security Features](#-security-features)
- [Testing & Linting](#-testing--linting)
- [Common Issues](#-common-issues)
- [License](#-license)

---

## 📖 Description
Claude Haha Keymaster is a high-availability, encrypted proxy server designed to extend the functionality of `claude-code-haha` (the community-maintained runnable version of the leaked Anthropic Claude Code). It solves two critical pain points for free-tier users:
1. **API Key Management**: Automatically rotates Nvidia NIM and OpenRouter free API keys to bypass rate limits and handle auth failures
2. **SOCKS Proxy Management**: Automatically fetches, validates, and rotates SOCKS/HTTP proxies from 22+ public proxy repositories to avoid IP-based rate limits

All secrets (API keys, proxy URLs) are encrypted at rest with AES-256-GCM, and every action is logged to an immutable audit trail. The tool runs as a local proxy on port 8082 (configurable) that `claude-code-haha` sends all API requests to.

---

## ✨ Core Features
- 🔐 **AES-256-GCM Encrypted Storage**: All API keys and proxies are encrypted with a user-provided master key before being stored in SQLite
- 🔄 **Automatic Key Rotation**: Cycles through Nvidia NIM/OpenRouter keys on rate limits (429), auth failures (401/403), and quota exhaustion
- 🌐 **Automatic Proxy Rotation**: Fetches SOCKS/HTTP proxies from 22+ public repositories, validates via TCP connect, and rotates on failure
- 📥 **Periodic Proxy Refresh**: Automatically fetches new proxies every 6 hours to maintain a fresh pool
- 📝 **Tamper-Evident Audit Logs**: All key/proxy actions, errors, and admin changes are logged to SQLite with timestamps and outcome status
- 🛡️ **Failure Protection**: Keys/proxies are cooled down or deactivated after consecutive failures to avoid wasting quotas
- 🎛️ **Admin API**: Secure REST API for dynamic key/proxy management without restarting the server
- 🤖 **Provider Translation**: Automatically converts Claude Code API requests to Nvidia NIM (OpenAI-compatible) format

---

## 🏗️ Architecture
```
┌─────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│  claude-code-haha   │────>│    Proxy Handler    │────>│   Provider API       │
│  (Claude Code UI)   │     │  (Request Routing) │     │ (Nvidia/OpenRouter) │
└─────────────────────┘     └────────┬─────────────┘     └──────────────────────┘
                                     │
                            ┌────────▼─────────────┐
                            │  Key Rotator         │
                            │  SOCKS Rotator       │
                            └────────┬─────────────┘
                                     │
                            ┌────────▼─────────────┐
                            │   State Manager      │
                            │ (SQLite + Encryption)│
                            └────────┬─────────────┘
                                     │
                            ┌────────▼─────────────┐
                            │ Proxy Resource Fetcher│
                            │ (22+ Public Sources) │
                            └──────────────────────┘
```

### Core Components
1. **State Manager**: Handles encrypted SQLite storage for keys, proxies, and audit logs
2. **Provider Registry**: Manages Nvidia/OpenRouter configuration and request/response translation
3. **Key Rotator**: Selects healthy API keys and handles rate limit/auth failure logic
4. **SOCKS Rotator**: Selects healthy SOCKS proxies and handles failure logic
5. **Proxy Resource Fetcher**: Periodically fetches and validates proxies from public repositories
6. **Proxy Handler**: Forwards requests to providers, applies rotation logic, exposes admin API

---

## 📦 Prerequisites
- [Bun](https://bun.sh) v1.0+ (runtime, package manager, test runner)
- OpenSSL (for generating master encryption key)
- Valid Nvidia NIM and/or OpenRouter API keys (free tiers available)
- Internet access (for proxy fetching and provider API requests)

---

## 🚀 Installation
```bash
# Clone the repository
git clone https://github.com/your-username/claude-haha-keymaster.git
cd claude-haha-keymaster

# Install dependencies
bun install

# Generate master encryption key (64-character hex string = 32 bytes)
openssl rand -hex 32 > master.key

# Copy example environment file
cp .env.example .env
```

---

## ⚙️ Configuration
Edit the `.env` file with your values:
```env
# Port the proxy server listens on (default: 8082)
KEYMASTER_PROXY_PORT=8082

# Directory for SQLite state and encryption artifacts (default: ~/.keymaster)
KEYMASTER_STATE_DIR=~/.keymaster

# 64-character hex string (32 bytes) for AES-256-GCM encryption
# Paste the contents of master.key here
KEYMASTER_MASTER_KEY=your_64_char_hex_key_here

# Optional: Bearer token for admin API authentication
# Generate with: openssl rand -hex 32
KEYMASTER_ADMIN_TOKEN=your_secure_admin_token_here
```

---

## 🏁 First Run
1. **Start the proxy server**:
   ```bash
   bun run start
   ```
   You should see output:
   ```
   Initial proxy fetch: 142 new proxies added
   Keymaster running on port 8082 | Auto-fetching proxies enabled
   State directory: /home/user/.keymaster
   Enabled providers: nvidia, openrouter
   ```

2. **Add your first API key** (via admin API):
   ```bash
   # Add Nvidia NIM key (free tier: 40 req/min)
   curl -X POST http://localhost:8082/admin/add-key \
     -H "Authorization: Bearer your_admin_token" \
     -H "Content-Type: application/json" \
     -d '{
       "provider": "nvidia",
       "api_key": "nvapi-your-nvidia-key-here",
       "rate_limit_per_min": 40,
       "daily_limit": 1000
     }'

   # Add OpenRouter key (free tier: ~20 req/min)
   curl -X POST http://localhost:8082/admin/add-key \
     -H "Authorization: Bearer your_admin_token" \
     -H "Content-Type: application/json" \
     -d '{
       "provider": "openrouter",
       "api_key": "sk-or-v1-your-openrouter-key-here",
       "rate_limit_per_min": 20,
       "daily_limit": 500
     }'
   ```

3. **Trigger initial proxy fetch** (if not auto-fetched on startup):
   ```bash
   curl -X POST http://localhost:8082/admin/fetch-proxies \
     -H "Authorization: Bearer your_admin_token"
   ```
   Response: `{"added": 142}` (number of new validated proxies added)

---

## 🛠️ Admin API Reference
All admin endpoints require Bearer token authentication if `KEYMASTER_ADMIN_TOKEN` is set.

| Endpoint | Method | Description | Request Body Example | Response Example |
|----------|--------|-------------|----------------------|-------------------|
| `/admin/add-key` | POST | Add a new API key | `{"provider": "nvidia", "api_key": "nvapi-xxx", "rate_limit_per_min": 40}` | `{"id": 1}` (201 Created) |
| `/admin/add-proxy` | POST | Manually add a SOCKS/HTTP proxy | `{"proxy_url": "socks5://127.0.0.1:1080", "proxy_type": "socks5"}` | `{"id": 1}` (201 Created) |
| `/admin/fetch-proxies` | POST | Trigger automatic proxy fetch from all public sources | N/A | `{"added": 142}` (200 OK) |
| `/admin/deactivate-key` | POST | Deactivate a compromised API key | `{"key_id": 1}` | `{"success": true}` (200 OK) |

---

## 🔗 Integration with Claude Haha
1. Navigate to your `claude-code-haha` installation directory
2. Edit (or create) the `.env` file to point to Keymaster:
   ```env
   # Point Claude Haha to Keymaster proxy
   ANTHROPIC_BASE_URL=http://localhost:8082
   # Keymaster manages keys, this value is ignored
   ANTHROPIC_AUTH_TOKEN=dummy-value
   # Disable telemetry to avoid leaking data
   DISABLE_TELEMETRY=1
   claude_code_disable_nonessential_traffic=1
   ```
3. Start `claude-code-haha`:
   ```bash
   ./bin/claude-haha
   ```
4. All requests from Claude Haha will now route through Keymaster, with automatic key and proxy rotation.

---

## 🌐 Automatic Proxy Sources
Keymaster automatically fetches and validates proxies from these 22 public repositories (no configuration required):
1. `https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/socks5_proxies.txt`
2. `https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/socks4_proxies.txt`
3. `https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/http_proxies.txt`
4. `https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks5.txt`
5. `https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks4.txt`
6. `https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/https.txt`
7. `https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt`
8. `https://raw.githubusercontent.com/Ian-Lusule/Proxies-GUI/main/assets/tested_proxies.json`
9. `https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/socks5/global/socks5_checked.txt`
10. `https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/socks4/global/socks4_checked.txt`
11. `https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/http/global/http_checked.txt`
12. `https://raw.githubusercontent.com/gitrecon1455/fresh-proxy-list/refs/heads/main/proxylist.txt`
13. `https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/README.md`
14. `https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/xResults/RAW.txt`
15. `https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/xResults/Proxies.txt`
16. `https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/socks5/socks5.txt`
17. `https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/socks4/socks4.txt`
18. `https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/https/https.txt`
19. `https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt`
20. `https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks4.txt`
21. `https://raw.githubusercontent.com/zloi-user/hideip.me/main/https.txt`
22. `https://raw.githubusercontent.com/VPSLabCloud/VPSLab-Free-Proxy-List/main/README.md`

All proxies are validated via TCP connect (5-second timeout) before being added to the pool. Proxies that fail 3 consecutive checks are automatically deactivated.

---

## 🔒 Security Features
- **Encryption at Rest**: All API keys and proxy URLs are encrypted with AES-256-GCM using a user-provided master key. The master key is never stored on disk.
- **Audit Logging**: All actions (key add, proxy fetch, rotation events, failures) are logged to SQLite with timestamps, outcome status, and hashed identifiers (no plaintext secrets in logs).
- **Failure Protection**:
  - API keys are cooled down for 1 minute on rate limits, deactivated after 3 auth failures
  - Proxies are cooled down for 1 minute on failure, deactivated after 3 consecutive failures
- **Admin API Security**: Optional Bearer token authentication for all admin endpoints
- **Request Isolation**: Each request uses a fresh proxy/key selection, no shared state between requests

---

## 🧪 Testing & Linting
The project includes full ESLint configuration and 15+ unit tests covering all core modules.

```bash
# Run linter (check for errors)
bun run lint

# Auto-fix lint errors
bun run lint:fix

# Run all tests
bun run test

# Run tests in watch mode (auto-rerun on file changes)
bun run test:watch
```

Test coverage includes:
- State manager encryption/decryption
- Provider registry request/response translation
- Key and SOCKS rotator logic
- Proxy resource fetching and validation
- Proxy handler request routing

---

## ❓ Common Issues
### 1. "FATAL: KEYMASTER_MASTER_KEY environment variable is required"
- Ensure you generated a master key with `openssl rand -hex 32`
- Paste the 64-character hex string into your `.env` file under `KEYMASTER_MASTER_KEY`

### 2. "No available keys for provider: nvidia"
- Add a valid API key via the `/admin/add-key` endpoint
- Check the Nvidia NIM key has not exceeded its daily quota

### 3. "No proxies available" errors
- Trigger a manual proxy fetch: `curl -X POST http://localhost:8082/admin/fetch-proxies -H "Authorization: Bearer your_admin_token"`
- Check audit logs for proxy fetch errors: `sqlite3 ~/.keymaster/state.db "SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 10;"`

### 4. Upstream connection errors
- Verify your API keys are valid and not expired
- Check if your network blocks connections to Nvidia/OpenRouter APIs
- View active proxies: `sqlite3 ~/.keymaster/state.db "SELECT id, proxy_type, is_active FROM proxies;"`

---

## 📄 License
This project is released for **educational and research use only**. It is original work independent of Anthropic's proprietary Claude Code codebase.

- Do not use this tool with leaked proprietary code in violation of Anthropic's Terms of Service
- Respect Nvidia NIM and OpenRouter free tier rate limits
- All proxy sources are public repositories - respect their respective licenses

The Keymaster proxy code is licensed under MIT (see LICENSE file). The `claude-code-haha` tool it integrates with is a community fork of leaked code - we take no responsibility for its use.

---

## 🙏 Acknowledgments
- Thanks to the maintainers of all public proxy repositories listed in [Automatic Proxy Sources](#-automatic-proxy-sources)
- The `claude-code-haha` community for maintaining the runnable Claude Code fork
- Anthropic for creating the original Claude Code tool (despite the accidental leak)

Yog-Sotho