import { StateManager } from "./state-manager.js";
import { StoredProxy } from "./types.js";

export class SocksRotator {
  private state: StateManager;

  constructor(state: StateManager) {
    this.state = state;
  }

  getNextSocksProxy(): StoredProxy | undefined {
    const proxies = this.state.getActiveSocksProxies();
    if (proxies.length === 0) return undefined;
    const selected = proxies[0];
    this.state.updateProxy(selected.id, { last_used: Date.now() });
    return selected;
  }

  markUsed(proxyId: number): void {
    this.state.updateProxy(proxyId, { last_used: Date.now(), validation_failures: 0 });
  }

  markFailed(proxyId: number): void {
    const proxy = this.state.getProxyById(proxyId);
    if (!proxy) return;

    const newFail = proxy.validation_failures + 1;
    const updates: Partial<StoredProxy> = { validation_failures: newFail };
    if (newFail >= 3) {
      updates.is_active = 0;
      updates.cooldown_until = Date.now() + 3_600_000;
    } else {
      updates.cooldown_until = Date.now() + 60_000;
    }

    this.state.updateProxy(proxyId, updates);
    const hash = this.state.getProxyHash(proxyId);
    if (hash) {
      this.state.logAudit({
        event_type: "socks_proxy_failed",
        proxy_hash: hash,
        details: `Proxy failed ${newFail} times, active: ${updates.is_active !== 0}`,
        outcome: "failure"
      });
    }
  }
}