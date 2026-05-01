import { StateManager } from "./state-manager.js";
import { ProviderRegistry } from "./provider-registry.js";
import { KeyRotator } from "./key-rotator.js";
import { SocksRotator } from "./socks-rotator.js";
import { ProxyHandler } from "./proxy-handler.js";
import { ProxyResourceFetcher } from "./proxy-resource-fetcher.js";

const PORT = parseInt(process.env.KEYMASTER_PROXY_PORT || "8082");
const STATE_DIR = process.env.KEYMASTER_STATE_DIR || `${process.env.HOME}/.keymaster`;
const MASTER_KEY = process.env.KEYMASTER_MASTER_KEY;
const ADMIN_TOKEN = process.env.KEYMASTER_ADMIN_TOKEN;

if (!MASTER_KEY) {
  console.error("FATAL: KEYMASTER_MASTER_KEY environment variable is required");
  process.exit(1);
}

const state = new StateManager(STATE_DIR, MASTER_KEY);
const providerRegistry = new ProviderRegistry();
const keyRotator = new KeyRotator(state, providerRegistry);
const socksRotator = new SocksRotator(state);
const proxyHandler = new ProxyHandler(state, providerRegistry, keyRotator, socksRotator, ADMIN_TOKEN);

const proxyFetcher = new ProxyResourceFetcher(state);
proxyFetcher.fetchAll().then(added => {
  console.log(`Initial proxy fetch: ${added} new proxies added`);
}).catch(err => {
  console.error("Initial proxy fetch failed:", err);
});

proxyFetcher.startPeriodicFetch(6);

console.log(`Keymaster running on port ${PORT} | Auto-fetching proxies enabled`);
console.log(`State directory: ${STATE_DIR}`);
console.log(`Enabled providers: ${providerRegistry.getAllProviders().join(", ")}`);

Bun.serve({
  port: PORT,
  async fetch(req) {
    return proxyHandler.handleRequest(req);
  },
  error(error) {
    console.error("Server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  proxyFetcher.stopPeriodicFetch();
  state.close();
  process.exit(0);
});