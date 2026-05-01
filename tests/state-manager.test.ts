import { describe, it, expect, beforeEach } from "bun:test";
import { StateManager } from "../src/state-manager.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("StateManager", () => {
  const testStateDir = join(process.cwd(), "test-state");
  let state: StateManager;

  beforeEach(() => {
    rmSync(testStateDir, { recursive: true, force: true });
    mkdirSync(testStateDir, { recursive: true });
    state = new StateManager(testStateDir, "a".repeat(64));
  });

  it("should encrypt and decrypt API keys", () => {
    const encryptResult = (state as unknown as { encrypt: (s: string) => { encrypted: string; iv: string; authTag: string } }).encrypt("nvapi-test123");
    const decrypted = (state as unknown as { decrypt: (e: string, i: string, a: string) => string }).decrypt(
      encryptResult.encrypted,
      encryptResult.iv,
      encryptResult.authTag
    );
    expect(decrypted).toBe("nvapi-test123");
  });

  it("should add and retrieve keys", () => {
    const id = state.addKey("nvidia", "nvapi-key1", 40, 1000);
    expect(id).toBeNumber();
    const keys = state.getActiveKeys("nvidia");
    expect(keys.length).toBe(1);
    expect(state.getDecryptedApiKey(id)).toBe("nvapi-key1");
  });

  it("should add and retrieve proxies", () => {
    const id = state.addProxy("socks5://127.0.0.1:1080", "socks5");
    expect(id).toBeNumber();
    const proxies = state.getActiveProxies("socks5");
    expect(proxies.length).toBe(1);
    expect(state.getDecryptedProxyUrl(id)).toBe("socks5://127.0.0.1:1080");
  });
});