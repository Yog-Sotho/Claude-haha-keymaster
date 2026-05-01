import { StateManager } from "./state-manager.js";
import { ProviderRegistry, ProviderType } from "./provider-registry.js";
import { StoredKey } from "./types.js";

export class KeyRotator {
  private state: StateManager;
  private providerRegistry: ProviderRegistry;

  constructor(state: StateManager, providerRegistry: ProviderRegistry) {
    this.state = state;
    this.providerRegistry = providerRegistry;
  }

  getNextKey(providerType: ProviderType): StoredKey | undefined {
    const activeKeys = this.state.getActiveKeys(providerType);
    if (activeKeys.length === 0) return undefined;

    const now = Date.now();
    const updatedKeys = activeKeys.map((key) => {
      if (now - key.last_min_start > 60000) {
        this.state.updateKey(key.id, { used_this_min: 0, last_min_start: now });
        key.used_this_min = 0;
        key.last_min_start = now;
      }
      return key;
    });

    const availableKey = updatedKeys.find(
      (key) => key.used_this_min < key.rate_limit_per_min && key.used_today < key.daily_limit
    );

    if (!availableKey) {
      return updatedKeys.sort((a, b) => a.cooldown_until - b.cooldown_until)[0];
    }
    return availableKey;
  }

  markKeyUsed(keyId: number): void {
    const key = this.state.getKeyById(keyId);
    if (!key) return;
    const now = Date.now();
    let { used_this_min, used_today, last_used, last_min_start } = key;

    if (now - last_min_start > 60000) {
      used_this_min = 0;
      last_min_start = now;
    }

    used_this_min += 1;
    used_today += 1;
    last_used = now;

    this.state.updateKey(keyId, {
      used_this_min,
      used_today,
      last_used,
      last_min_start,
    });
  }

  markKeyRateLimited(keyId: number, retryAfterMs: number): void {
    const now = Date.now();
    this.state.updateKey(keyId, {
      cooldown_until: now + retryAfterMs,
      used_this_min: 9999,
    });
    const keyHash = this.state.getKeyHash(keyId);
    if (keyHash) {
      this.state.logAudit({
        event_type: "rate_limit_hit",
        provider_type: this.state.getKeyById(keyId)?.provider_type,
        key_hash: keyHash,
        details: `Key rate limited, cooldown until ${new Date(now + retryAfterMs).toISOString()}`,
        outcome: "warning",
      });
    }
  }

  markKeyAuthFailure(keyId: number): void {
    const key = this.state.getKeyById(keyId);
    if (!key) return;
    const newFailureCount = key.failure_count + 1;
    const updates: Partial<StoredKey> = { failure_count: newFailureCount };

    if (newFailureCount >= 3) {
      updates.is_active = 0;
    }

    this.state.updateKey(keyId, updates);
    const keyHash = this.state.getKeyHash(keyId);
    if (keyHash) {
      this.state.logAudit({
        event_type: "auth_error",
        provider_type: key.provider_type,
        key_hash: keyHash,
        details: `Auth failure, failure count: ${newFailureCount}, active: ${updates.is_active !== 0}`,
        outcome: "failure",
      });
    }
  }
}