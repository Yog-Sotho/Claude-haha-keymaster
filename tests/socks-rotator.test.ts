import { describe, it, expect, beforeEach } from "bun:test";
import { StateManager } from "../src/state-manager.js";
import { SocksRotator } from "../src/socks-rotator.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("SocksRotator", () => {
  const testStateDir = join(process.cwd(), "test-state-socks");
  let state: StateManager;
  let rotator: SocksRotator;

  beforeEach(() => {
    rmSync(testStateDir, { recursive: true, force: true });
    mkdirSync(testStateDir, { recursive: true });
    state = new StateManager(testStateDir, "a".repeat(64));
    rotator = new SocksRotator(state);
  });

  it("should get next socks proxy", () => {
    state.addProxy("socks5://127.0.0.1:1080", "socks5");
    const proxy = rotator.getNextSocksProxy();
    expect(proxy).toBeDefined();
    expect(proxy?.proxy_type).toBe("socks5");
  });
});