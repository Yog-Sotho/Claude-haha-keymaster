git clone https://github.com/Yog-Sotho/Claude-haha-keymaster
cd claude-haha-keymaster
openssl rand -hex 32 > master.key
cp .env.example .env
# Edit .env: set KEYMASTER_MASTER_KEY to contents of master.key
bun run start
