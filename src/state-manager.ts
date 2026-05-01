import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { StoredKey, StoredProxy, AuditLogEntry, ProxyType } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const MASTER_KEY_LENGTH = 32;

export class StateManager {
  private db: Database;
  private masterKey: Buffer;
  private stateDir: string;

  constructor(stateDir: string, masterKeyHex: string) {
    this.stateDir = stateDir;
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }

    if (!/^[0-9a-f]{64}$/i.test(masterKeyHex)) {
      throw new Error("KEYMASTER_MASTER_KEY must be a 64-character hex string (32 bytes)");
    }
    this.masterKey = Buffer.from(masterKeyHex, "hex");

    const dbPath = `${stateDir}/state.db`;
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_type TEXT NOT NULL,
        encrypted_api_key TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        rate_limit_per_min INTEGER NOT NULL DEFAULT 40,
        daily_limit INTEGER NOT NULL DEFAULT 1000,
        used_this_min INTEGER NOT NULL DEFAULT 0,
        used_today INTEGER NOT NULL DEFAULT 0,
        last_used INTEGER NOT NULL DEFAULT 0,
        last_min_start INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS proxies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        encrypted_proxy_url TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        proxy_type TEXT NOT NULL DEFAULT 'socks5',
        last_used INTEGER NOT NULL DEFAULT 0,
        last_validated INTEGER NOT NULL DEFAULT 0,
        validation_failures INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        event_type TEXT NOT NULL,
        provider_type TEXT,
        key_hash TEXT,
        proxy_hash TEXT,
        details TEXT NOT NULL,
        outcome TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_keys_provider ON keys(provider_type);
      CREATE INDEX IF NOT EXISTS idx_keys_active ON keys(is_active);
      CREATE INDEX IF NOT EXISTS idx_proxies_type ON proxies(proxy_type);
      CREATE INDEX IF NOT EXISTS idx_proxies_active ON proxies(is_active);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
    `);
  }

  private encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const encrypted = cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return { encrypted, iv: iv.toString("hex"), authTag };
  }

  private decrypt(encrypted: string, iv: string, authTag: string): string {
    const ivBuf = Buffer.from(iv, "hex");
    const authTagBuf = Buffer.from(authTag, "hex");
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, ivBuf);
    decipher.setAuthTag(authTagBuf);
    return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
  }

  getDecryptedApiKey(keyId: number): string | undefined {
    const key = this.getKeyById(keyId);
    if (!key) return undefined;
    return this.decrypt(key.encrypted_api_key, key.iv, key.auth_tag);
  }

  getDecryptedProxyUrl(proxyId: number): string | undefined {
    const proxy = this.getProxyById(proxyId);
    if (!proxy) return undefined;
    return this.decrypt(proxy.encrypted_proxy_url, proxy.iv, proxy.auth_tag);
  }

  addKey(provider: ProviderType, apiKey: string, rateLimit: number, dailyLimit: number): number {
    const { encrypted, iv, authTag } = this.encrypt(apiKey);
    return this.db.prepare(`
      INSERT INTO keys (provider_type, encrypted_api_key, iv, auth_tag, rate_limit_per_min, daily_limit)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(provider, encrypted, iv, authTag, rateLimit, dailyLimit).lastInsertRowid as number;
  }

  getKeyById(keyId: number): StoredKey | undefined {
    return this.db.prepare(`SELECT * FROM keys WHERE id = ?`).get(keyId) as StoredKey | undefined;
  }

  getActiveKeys(provider: ProviderType): StoredKey[] {
    return this.db.prepare(`
      SELECT * FROM keys WHERE provider_type = ? AND is_active = 1 AND cooldown_until < ?
      ORDER BY last_used ASC
    `).all(provider, Date.now()) as StoredKey[];
  }

  updateKey(keyId: number, updates: Partial<StoredKey>): void {
    const setClauses = Object.keys(updates).map((key) => `${key} = ?`).join(", ");
    const values = Object.values(updates);
    this.db.prepare(`UPDATE keys SET ${setClauses} WHERE id = ?`).run(...values, keyId);
  }

  addProxy(proxyUrl: string, type: ProxyType = "socks5"): number {
    if (!this.isValidProxyUrl(proxyUrl, type)) {
      throw new Error(`Invalid proxy URL for type ${type}: ${proxyUrl}`);
    }
    const { encrypted, iv, authTag } = this.encrypt(proxyUrl);
    return this.db.prepare(`
      INSERT INTO proxies (encrypted_proxy_url, iv, auth_tag, proxy_type)
      VALUES (?, ?, ?, ?)
    `).run(encrypted, iv, authTag, type).lastInsertRowid as number;
  }

  addProxiesBulk(proxyUrls: string[], defaultType: ProxyType = "socks5"): number {
    let inserted = 0;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO proxies (encrypted_proxy_url, iv, auth_tag, proxy_type)
      VALUES (?, ?, ?, ?)
    `);
    for (const url of proxyUrls) {
      try {
        const type = this.detectProxyType(url, defaultType);
        if (!this.isValidProxyUrl(url, type)) continue;
        const { encrypted, iv, authTag } = this.encrypt(url);
        stmt.run(encrypted, iv, authTag, type);
        inserted++;
      } catch (_error) {
        // Skip invalid entries
      }
    }
    return inserted;
  }

  getProxyById(proxyId: number): StoredProxy | undefined {
    return this.db.prepare(`SELECT * FROM proxies WHERE id = ?`).get(proxyId) as StoredProxy | undefined;
  }

  getActiveProxies(type?: ProxyType): StoredProxy[] {
    if (type) {
      return this.db.prepare(`
        SELECT * FROM proxies WHERE proxy_type = ? AND is_active = 1 AND cooldown_until < ?
        ORDER BY last_used ASC
      `).all(type, Date.now()) as StoredProxy[];
    }
    return this.db.prepare(`
      SELECT * FROM proxies WHERE is_active = 1 AND cooldown_until < ?
      ORDER BY last_used ASC
    `).all(Date.now()) as StoredProxy[];
  }

  getActiveSocksProxies(): StoredProxy[] {
    return this.db.prepare(`
      SELECT * FROM proxies WHERE proxy_type IN ('socks4','socks5') AND is_active = 1 AND cooldown_until < ?
      ORDER BY last_used ASC
    `).all(Date.now()) as StoredProxy[];
  }

  updateProxy(proxyId: number, updates: Partial<StoredProxy>): void {
    const setClauses = Object.keys(updates).map((key) => `${key} = ?`).join(", ");
    const values = Object.values(updates);
    this.db.prepare(`UPDATE proxies SET ${setClauses} WHERE id = ?`).run(...values, proxyId);
  }

  private isValidProxyUrl(url: string, type: ProxyType): boolean {
    if (type === "socks4" || type === "socks5") {
      return /^socks[45]:\/\//.test(url) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}$/.test(url);
    }
    if (type === "http" || type === "https") {
      return /^https?:\/\//.test(url) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}$/.test(url);
    }
    return false;
  }

  private detectProxyType(url: string, fallback: ProxyType): ProxyType {
    if (/^socks4:\/\//.test(url)) return "socks4";
    if (/^socks5:\/\//.test(url)) return "socks5";
    if (/^https?:\/\//.test(url)) return url.startsWith("https") ? "https" : "http";
    return fallback;
  }

  logAudit(event: Omit<AuditLogEntry, "id" | "timestamp">): void {
    this.db.prepare(`
      INSERT INTO audit_logs (event_type, provider_type, key_hash, proxy_hash, details, outcome)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event.event_type,
      event.provider_type || null,
      event.key_hash || null,
      event.proxy_hash || null,
      event.details,
      event.outcome
    );
  }

  getKeyHash(keyId: number): string | undefined {
    const key = this.getKeyById(keyId);
    if (!key) return undefined;
    const decrypted = this.getDecryptedApiKey(keyId);
    if (!decrypted) return undefined;
    return createHash("sha256").update(decrypted).digest("hex").slice(0, 16);
  }

  getProxyHash(proxyId: number): string | undefined {
    const proxy = this.getProxyById(proxyId);
    if (!proxy) return undefined;
    const decrypted = this.getDecryptedProxyUrl(proxyId);
    if (!decrypted) return undefined;
    return createHash("sha256").update(decrypted).digest("hex").slice(0, 16);
  }

  close(): void {
    this.db.close();
  }
}