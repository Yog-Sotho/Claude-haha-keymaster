import { describe, it, expect } from "bun:test";
import { ProviderRegistry } from "../src/provider-registry.js";

describe("ProviderRegistry", () => {
  const registry = new ProviderRegistry();

  it("should return all providers", () => {
    expect(registry.getAllProviders()).toContain("nvidia");
    expect(registry.getAllProviders()).toContain("openrouter");
  });

  it("should get nvidia provider config", () => {
    const config = registry.getProvider("nvidia");
    expect(config.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("should map anthropic models to nvidia", () => {
    const mapFn = (registry as unknown as { mapAnthropicModelToNvidia: (s: string) => string }).mapAnthropicModelToNvidia;
    expect(mapFn("claude-3-5-sonnet-20241022")).toBe("nvidia/llama-3.1-405b-instruct");
  });
});