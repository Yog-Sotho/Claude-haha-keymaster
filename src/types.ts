import { IncomingHttpHeaders } from "node:http";

export type ProviderType = "nvidia" | "openrouter";

export type ProxyType = "socks4" | "socks5" | "http" | "https";

export interface ProviderConfig {
  type: ProviderType;
  baseUrl: string;
  authHeader: string;
  authHeaderValue: (apiKey: string) => string;
  translateRequest?: (reqBody: Record<string, unknown>, headers: IncomingHttpHeaders) => { body: Record<string, unknown>; headers: IncomingHttpHeaders };
  translateResponse?: (respBody: Record<string, unknown>) => Record<string, unknown>;
  parseRateLimit: (resp: Response) => Promise<{ isRateLimited: boolean; retryAfterMs: number }>;
  parseAuthError: (resp: Response) => Promise<boolean>;
  defaultRateLimitPerMin: number;
  defaultDailyLimit: number;
}

export interface StoredKey {
  id: number;
  provider_type: ProviderType;
  encrypted_api_key: string;
  iv: string;
  auth_tag: string;
  rate_limit_per_min: number;
  daily_limit: number;
  used_this_min: number;
  used_today: number;
  last_used: number;
  last_min_start: number;
  cooldown_until: number;
  failure_count: number;
  is_active: number;
  created_at: number;
}

export interface StoredProxy {
  id: number;
  encrypted_proxy_url: string;
  iv: string;
  auth_tag: string;
  proxy_type: ProxyType;
  last_used: number;
  last_validated: number;
  validation_failures: number;
  cooldown_until: number;
  is_active: number;
  created_at: number;
}

export interface AuditLogEntry {
  id: number;
  timestamp: number;
  event_type: string;
  provider_type?: ProviderType;
  key_hash?: string;
  proxy_hash?: string;
  details: string;
  outcome: "success" | "failure" | "warning";
}

export interface ProxyResource {
  url: string;
  format: "text" | "json";
  proxyTypeOverride?: ProxyType;
}