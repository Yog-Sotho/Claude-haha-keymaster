import { describe, it, expect, beforeEach } from "bun:test";
import { StateManager } from "../src/state-manager.js";
import { ProviderRegistry } from "../src/provider-registry.js";
import { KeyRotator } from "../src/key-rotator.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("KeyRotator", () => {
  const testStateDir = join(process.cwd(), "test-state-rotator");
  let state: StateManager;
  let rotator: KeyRotator;

  beforeEach(() => {
    rmSync(testStateDir, { recursive: true, force: true });
    mkdirSync(testStateDir, { recursive: true });
    state = new StateManager(testStateDir, "a".repeat(64));
    rotator = new KeyRotator(state, new ProviderRegistry());
  });

  it("should get next key", () => {
    state.addKey("nvidia", "nvapi-key1", 40, 1000);
    const key = rotator.getNextKey("nvidia");
    expect(key).toBeDefined();
  });

  it("should mark key as used", () => {
    const id = state.addKey("nvidia", "nvapi-key1", 40, 1000);
    rotator.markKeyUsed(id);
    const key = state.getKeyById(id);
    expect(key?.used_today).toBe(1);
  });
});