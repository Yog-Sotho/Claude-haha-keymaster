import { StateManager } from "./state-manager.js";
import { ProviderRegistry, ProviderType } from "./provider-registry.js";
import { KeyRotator } from "./key-rotator.js";
import { SocksRotator } from "./socks-rotator.js";
import { StoredKey, StoredProxy } from "./types.js";
import { SocksProxyAgent } from "socks-proxy-agent";
import { fetch as undiciFetch } from "undici";

export class ProxyHandler {
  private state: StateManager;
  private providerRegistry: ProviderRegistry;
  private keyRotator: KeyRotator;
  private socksRotator: SocksRotator;
  private adminToken?: string;

  constructor(
    state: StateManager,
    providerRegistry: ProviderRegistry,
    keyRotator: KeyRotator,
    socksRotator: SocksRotator,
    adminToken?: string
  ) {
    this.state = state;
    this.providerRegistry = providerRegistry;
    this.keyRotator = keyRotator;
    this.socksRotator = socksRotator;
    this.adminToken = adminToken;
  }

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path.startsWith("/admin/")) return this.handleAdmin(req, path);
    if (req.method !== "POST" || path !== "/v1/messages") {
      return new Response("Not Found", { status: 404 });
    }

    const providerType = (url.searchParams.get("provider") as ProviderType) || "nvidia";
    if (!this.providerRegistry.getAllProviders().includes(providerType)) {
      return new Response(`Unsupported provider: ${providerType}`, { status: 400 });
    }

    const provider = this.providerRegistry.getProvider(providerType);
    const key = this.keyRotator.getNextKey(providerType);
    if (!key) return new Response(`No keys for ${providerType}`, { status: 503 });

    const decryptedKey = this.state.getDecryptedApiKey(key.id);
    if (!decryptedKey) return new Response("Failed to decrypt API key", { status: 500 });
    const keyHash = this.state.getKeyHash(key.id);

    const socksProxy = this.socksRotator.getNextSocksProxy();
    let proxyHash: string | undefined;
    let agent: SocksProxyAgent | undefined;

    if (socksProxy) {
      const proxyUrl = this.state.getDecryptedProxyUrl(socksProxy.id);
      if (proxyUrl) {
        proxyHash = this.state.getProxyHash(socksProxy.id);
        try {
          agent = new SocksProxyAgent(proxyUrl);
          this.socksRotator.markUsed(socksProxy.id);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.socksRotator.markFailed(socksProxy.id);
          this.state.logAudit({
            event_type: "socks_proxy_error",
            proxy_hash: proxyHash,
            details: `Failed to create SOCKS agent: ${message}`,
            outcome: "failure"
          });
          return this.handleRequest(req);
        }
      }
    }

    let upstreamBody: Record<string, unknown>;
    try {
      upstreamBody = await req.json() as Record<string, unknown>;
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    let upstreamHeaders = Object.fromEntries(req.headers.entries()) as Record<string, string>;
    if (provider.translateRequest) {
      const translated = provider.translateRequest(upstreamBody, upstreamHeaders);
      upstreamBody = translated.body as Record<string, unknown>;
      upstreamHeaders = translated.headers as Record<string, string>;
    }

    upstreamHeaders[provider.authHeader] = provider.authHeaderValue(decryptedKey);
    delete upstreamHeaders["host"];

    const upstreamPath = provider.translateRequest ? "/v1/chat/completions" : "/v1/messages";
    const upstreamUrl = `${provider.baseUrl}${upstreamPath}`;

    try {
      const resp = await undiciFetch(upstreamUrl, {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamBody),
        // @ts-ignore
        dispatcher: agent
      });

      if (await provider.parseRateLimit(resp).then(r => r.isRateLimited)) {
        this.keyRotator.markKeyRateLimited(key.id, 60000);
        return this.handleRequest(req);
      }

      if (await provider.parseAuthError(resp)) {
        this.keyRotator.markKeyAuthFailure(key.id);
        return this.handleRequest(req);
      }

      this.keyRotator.markKeyUsed(key.id);
      let respBody = await resp.json() as Record<string, unknown>;
      if (provider.translateResponse) respBody = provider.translateResponse(respBody);

      return new Response(JSON.stringify(respBody), {
        status: resp.status,
        headers: { "content-type": "application/json" }
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (socksProxy) this.socksRotator.markFailed(socksProxy.id);
      this.state.logAudit({
        event_type: "upstream_request_error",
        provider_type: providerType,
        key_hash: keyHash,
        proxy_hash: proxyHash,
        details: `Upstream error: ${message}`,
        outcome: "failure"
      });
      return new Response(`Upstream error: ${message}`, { status: 502 });
    }
  }

  private async handleAdmin(req: Request, path: string): Promise<Response> {
    if (this.adminToken) {
      const authHeader = req.headers.get("authorization");
      if (!authHeader || authHeader !== `Bearer ${this.adminToken}`) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    if (path === "/admin/add-key" && req.method === "POST") {
      try {
        const body = await req.json() as Record<string, unknown>;
        const provider = body.provider as ProviderType;
        const apiKey = body.api_key as string;
        if (!provider || !apiKey) return new Response("Missing provider or api_key", { status: 400 });
        const cfg = this.providerRegistry.getProvider(provider);
        const id = this.state.addKey(
          provider,
          apiKey,
          (body.rate_limit_per_min as number) || cfg.defaultRateLimitPerMin,
          (body.daily_limit as number) || cfg.defaultDailyLimit
        );
        return new Response(JSON.stringify({ id }), { status: 201, headers: { "content-type": "application/json" } });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`Error adding key: ${message}`, { status: 400 });
      }
    }

    if (path === "/admin/add-proxy" && req.method === "POST") {
      try {
        const body = await req.json() as Record<string, unknown>;
        const proxyUrl = body.proxy_url as string;
        const proxyType = (body.proxy_type as ProxyType) || "socks5";
        if (!proxyUrl) return new Response("Missing proxy_url", { status: 400 });
        const id = this.state.addProxy(proxyUrl, proxyType);
        return new Response(JSON.stringify({ id }), { status: 201, headers: { "content-type": "application/json" } });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`Error adding proxy: ${message}`, { status: 400 });
      }
    }

    if (path === "/admin/fetch-proxies" && req.method === "POST") {
      const fetcher = new ProxyResourceFetcher(this.state);
      const added = await fetcher.fetchAll();
      return new Response(JSON.stringify({ added }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response("Not Found", { status: 404 });
  }
}