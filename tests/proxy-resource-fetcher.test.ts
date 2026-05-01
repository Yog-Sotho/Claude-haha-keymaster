import { describe, it, expect, beforeEach } from "bun:test";
import { StateManager } from "../src/state-manager.js";
import { ProxyResourceFetcher } from "../src/proxy-resource-fetcher.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("ProxyResourceFetcher", () => {
  const testStateDir = join(process.cwd(), "test-state-fetcher");
  let fetcher: ProxyResourceFetcher;

  beforeEach(() => {
    rmSync(testStateDir, { recursive: true, force: true });
    mkdirSync(testStateDir, { recursive: true });
    const state = new StateManager(testStateDir, "a".repeat(64));
    fetcher = new ProxyResourceFetcher(state);
  });

  it("should parse text content", () => {
    const text = `
127.0.0.1:1080
socks5://192.168.1.1:8080
# comment
http://10.0.0.1:3128
    `;
    const parseFn = (fetcher as unknown as { parseTextContent: (s: string, t?: string) => string[] }).parseTextContent;
    const proxies = parseFn(text, "socks5");
    expect(proxies.length).toBe(3);
  });
});