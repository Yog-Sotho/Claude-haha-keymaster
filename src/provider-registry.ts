import { ProviderConfig, ProviderType } from "./types.js";

export class ProviderRegistry {
  private providers: Map<ProviderType, ProviderConfig> = new Map();

  constructor() {
    this.registerNvidia();
    this.registerOpenRouter();
  }

  private registerNvidia(): void {
    const config: ProviderConfig = {
      type: "nvidia",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      authHeader: "api-key",
      authHeaderValue: (apiKey: string) => apiKey,
      translateRequest: (reqBody: Record<string, unknown>, headers: Record<string, unknown>) => {
        const openaiBody: Record<string, unknown> = {
          model: this.mapAnthropicModelToNvidia(reqBody.model as string),
          messages: this.convertAnthropicMessagesToOpenAI(reqBody.messages as unknown[]),
          max_tokens: reqBody.max_tokens,
          temperature: reqBody.temperature,
          tools: reqBody.tools ? this.convertAnthropicToolsToOpenAI(reqBody.tools as unknown[]) : undefined,
          stream: reqBody.stream,
        };
        Object.keys(openaiBody).forEach((key) => openaiBody[key] === undefined && delete openaiBody[key]);
        const newHeaders = { ...headers } as Record<string, unknown>;
        delete newHeaders["anthropic-version"];
        delete newHeaders["x-api-key"];
        newHeaders["content-type"] = "application/json";
        return { body: openaiBody, headers: newHeaders as never };
      },
      translateResponse: (respBody: Record<string, unknown>) => ({
        id: respBody.id as string,
        type: "message",
        role: "assistant",
        model: this.mapNvidiaModelToAnthropic(respBody.model as string),
        content: (respBody.choices as Array<Record<string, unknown>>)?.[0]?.message?.content
          ? [{ type: "text", text: (respBody.choices as Array<Record<string, unknown>>)[0].message.content as string }]
          : [],
        usage: {
          input_tokens: (respBody.usage as Record<string, number>)?.prompt_tokens || 0,
          output_tokens: (respBody.usage as Record<string, number>)?.completion_tokens || 0,
        },
        stop_reason: this.mapOpenAIStopReasonToAnthropic((respBody.choices as Array<Record<string, unknown>>)?.[0]?.finish_reason as string || "stop"),
      }),
      parseRateLimit: async (resp: Response) => {
        if (resp.status === 429) {
          const retryAfter = resp.headers.get("retry-after");
          const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
          return { isRateLimited: true, retryAfterMs };
        }
        return { isRateLimited: false, retryAfterMs: 0 };
      },
      parseAuthError: async (resp: Response) => resp.status === 401 || resp.status === 403,
      defaultRateLimitPerMin: 40,
      defaultDailyLimit: 1000,
    };
    this.providers.set("nvidia", config);
  }

  private registerOpenRouter(): void {
    const config: ProviderConfig = {
      type: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      authHeader: "Authorization",
      authHeaderValue: (apiKey: string) => `Bearer ${apiKey}`,
      translateRequest: undefined,
      translateResponse: undefined,
      parseRateLimit: async (resp: Response) => {
        if (resp.status === 429) {
          const body = await resp.json().catch(() => ({} as Record<string, unknown>));
          const retryAfter = (body?.error as Record<string, unknown>)?.metadata?.retry_after as number || 60;
          return { isRateLimited: true, retryAfterMs: retryAfter * 1000 };
        }
        return { isRateLimited: false, retryAfterMs: 0 };
      },
      parseAuthError: async (resp: Response) => resp.status === 401 || resp.status === 403,
      defaultRateLimitPerMin: 20,
      defaultDailyLimit: 500,
    };
    this.providers.set("openrouter", config);
  }

  getProvider(type: ProviderType): ProviderConfig {
    const provider = this.providers.get(type);
    if (!provider) throw new Error(`Provider ${type} not registered`);
    return provider;
  }

  getAllProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  private mapAnthropicModelToNvidia(model: string): string {
    const modelMap: Record<string, string> = {
      "claude-3-5-sonnet-20241022": "nvidia/llama-3.1-405b-instruct",
      "claude-3-5-haiku-20241022": "nvidia/llama-3.1-8b-instruct",
      "claude-3-opus-20240229": "nvidia/llama-3.1-405b-instruct",
    };
    return modelMap[model] || "nvidia/llama-3.1-70b-instruct";
  }

  private mapNvidiaModelToAnthropic(model: string): string {
    const modelMap: Record<string, string> = {
      "nvidia/llama-3.1-405b-instruct": "claude-3-5-sonnet-20241022",
      "nvidia/llama-3.1-70b-instruct": "claude-3-5-sonnet-20241022",
      "nvidia/llama-3.1-8b-instruct": "claude-3-5-haiku-20241022",
    };
    return modelMap[model] || "claude-3-5-sonnet-20241022";
  }

  private convertAnthropicMessagesToOpenAI(messages: unknown[]): Array<Record<string, unknown>> {
    return messages.map((msg) => ({
      role: (msg as Record<string, string>).role === "user" ? "user" : "assistant",
      content: (msg as Record<string, unknown[]>).content
        .map((c: Record<string, unknown>) => {
          if (c.type === "text") return { type: "text", text: c.text };
          if (c.type === "image") {
            return { type: "image_url", image_url: { url: `data:${(c.source as Record<string, string>).media_type};base64,${(c.source as Record<string, string>).data}` } };
          }
          return c;
        })
        .filter(Boolean),
    }));
  }

  private convertAnthropicToolsToOpenAI(tools: unknown[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: (tool as Record<string, string>).name,
        description: (tool as Record<string, string>).description,
        parameters: (tool as Record<string, unknown>).input_schema,
      },
    }));
  }

  private mapOpenAIStopReasonToAnthropic(reason: string): string {
    const map: Record<string, string> = {
      stop: "end_turn",
      length: "max_tokens",
      tool_calls: "tool_use",
    };
    return map[reason] || "end_turn";
  }
}