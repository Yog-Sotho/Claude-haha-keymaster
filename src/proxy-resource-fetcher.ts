import { StateManager, ProxyType } from "./state-manager.js";
import { ProxyResource } from "./types.js";
import { createHash } from "node:crypto";

export class ProxyResourceFetcher {
  private state: StateManager;
  private resources: ProxyResource[] = [];
  private fetchInterval: ReturnType<typeof setInterval> | null = null;

  constructor(state: StateManager) {
    this.state = state;
    this.initializeResources();
  }

  private initializeResources(): void {
    this.resources = [
      { url: "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/socks5_proxies.txt", format: "text", proxyTypeOverride: "socks5" },
      { url: "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/socks4_proxies.txt", format: "text", proxyTypeOverride: "socks4" },
      { url: "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/http_proxies.txt", format: "text", proxyTypeOverride: "http" },
      { url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks5.txt", format: "text", proxyTypeOverride: "socks5" },
      { url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks4.txt", format: "text", proxyTypeOverride: "socks4" },
      { url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/https.txt", format: "text", proxyTypeOverride: "https" },
      { url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt", format: "text", proxyTypeOverride: "http" },
      { url: "https://raw.githubusercontent.com/Ian-Lusule/Proxies-GUI/main/assets/tested_proxies.json", format: "json" },
      { url: "https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/socks5/global/socks5_checked.txt", format: "text", proxyTypeOverride: "socks5" },
      { url: "https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/socks4/global/socks4_checked.txt", format: "text", proxyTypeOverride: "socks4" },
      { url: "https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/http/global/http_checked.txt", format: "text", proxyTypeOverride: "http" },
      { url: "https://raw.githubusercontent.com/gitrecon1455/fresh-proxy-list/refs/heads/main/proxylist.txt", format: "text" },
      { url: "https://raw.githubusercontent.com/vmheaven/VMHeaven.io-Free-Proxy-List/main/README.md", format: "text" },
      { url: "https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/xResults/RAW.txt", format: "text" },
      { url: "https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/xResults/Proxies.txt", format: "text" },
      { url: "https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/socks5/socks5.txt", format: "text", proxyTypeOverride: "socks5" },
      { url: "https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/socks4/socks4.txt", format: "text", proxyTypeOverride: "socks4" },
      { url: "https://raw.githubusercontent.com/officialputuid/ProxyForEveryone/main/https/https.txt", format: "text", proxyTypeOverride: "https" },
      { url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt", format: "text", proxyTypeOverride: "socks5" },
      { url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks4.txt", format: "text", proxyTypeOverride: "socks4" },
      { url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/https.txt", format: "text", proxyTypeOverride: "https" },
      { url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt", format: "text", proxyTypeOverride: "http" },
      { url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/connect.txt", format: "text" },
      { url: "https://raw.githubusercontent.com/VPSLabCloud/VPSLab-Free-Proxy-List/main/README.md", format: "text" },
    ];
  }

  async fetchAll(): Promise<number> {
    let totalAdded = 0;
    for (const resource of this.resources) {
      try {
        const added = await this.fetchFromResource(resource);
        totalAdded += added;
        this.state.logAudit({
          event_type: "proxy_resource_fetch",
          details: `Fetched ${added} proxies from ${resource.url}`,
          outcome: "success"
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.state.logAudit({
          event_type: "proxy_resource_fetch_error",
          details: `Failed to fetch from ${resource.url}: ${message}`,
          outcome: "failure"
        });
      }
    }
    return totalAdded;
  }

  private async fetchFromResource(resource: ProxyResource): Promise<number> {
    const response = await fetch(resource.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Keymaster/1.0)" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const content = await response.text();
    let proxyUrls: string[] = [];

    if (resource.format === "json") {
      proxyUrls = this.parseJsonContent(content);
    } else {
      proxyUrls = this.parseTextContent(content, resource.proxyTypeOverride);
    }

    const existingProxies = this.state.getActiveProxies();
    const existingSet = new Set(
      existingProxies.map((p) => this.state.getProxyHash(p.id)).filter(Boolean) as string[]
    );

    const newProxies = proxyUrls.filter((url) => {
      const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
      return !existingSet.has(hash);
    });

    if (newProxies.length === 0) return 0;

    const validatedProxies: string[] = [];
    for (const url of newProxies) {
      if (await this.validateProxy(url)) validatedProxies.push(url);
    }

    return this.state.addProxiesBulk(validatedProxies, resource.proxyTypeOverride || "socks5");
  }

  private parseTextContent(content: string, defaultType?: ProxyType): string[] {
    const lines = content.split("\n");
    const proxies: string[] = [];
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) continue;
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}$/.test(line)) {
        proxies.push(`socks5://${line}`);
      } else if (/^socks[45]:\/\//.test(line)) {
        proxies.push(line);
      } else if (/^https?:\/\//.test(line)) {
        proxies.push(line);
      } else if (/^connect:\/\//.test(line)) {
        proxies.push(line.replace("connect://", "socks5://"));
      }
    }
    return proxies;
  }

  private parseJsonContent(content: string): string[] {
    try {
      const data = JSON.parse(content);
      const proxies: string[] = [];
      if (Array.isArray(data)) {
        for (const item of data) {
          if (typeof item === "string") {
            proxies.push(item);
          } else if (item && typeof item === "object") {
            const ip = item.ip || item.host || item.address;
            const port = item.port || item.port;
            const type = item.type || item.protocol;
            if (ip && port) {
              if (type === "socks5" || type === "socks4") {
                proxies.push(`${type}://${ip}:${port}`);
              } else if (type === "http" || type === "https") {
                proxies.push(`${type}://${ip}:${port}`);
              } else {
                proxies.push(`socks5://${ip}:${port}`);
              }
            }
          }
        }
      }
      return proxies;
    } catch {
      return [];
    }
  }

  private async validateProxy(proxyUrl: string): Promise<boolean> {
    const match = proxyUrl.match(/:\/\/([^:]+):(\d+)/);
    if (!match) return false;
    const host = match[1];
    const port = parseInt(match[2]);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      Bun.connect({
        hostname: host,
        port: port,
        socket: {
          open() {
            clearTimeout(timeout);
            this.close();
            return true;
          },
          close() {},
          data() {},
          error(_err) {
            clearTimeout(timeout);
            return false;
          }
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  startPeriodicFetch(intervalHours = 6): void {
    if (this.fetchInterval) clearInterval(this.fetchInterval);
    this.fetchInterval = setInterval(() => {
      this.fetchAll().catch((err) => {
        this.state.logAudit({
          event_type: "periodic_fetch_error",
          details: `Periodic fetch failed: ${err.message}`,
          outcome: "failure"
        });
      });
    }, intervalHours * 60 * 60 * 1000);
  }

  stopPeriodicFetch(): void {
    if (this.fetchInterval) {
      clearInterval(this.fetchInterval);
      this.fetchInterval = null;
    }
  }
}