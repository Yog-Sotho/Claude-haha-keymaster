#!/usr/bin/env python3
import json
import os
import sys
import uuid
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
import httpx

# === CONFIGURATION (production-grade, only these two env vars needed) ===
LM_STUDIO_URL = os.getenv("LM_STUDIO_URL", "http://localhost:1234/v1")
BRIDGE_PORT = int(os.getenv("BRIDGE_PORT", "8789"))

# Keep original TOOL_DISCIPLINE exactly as in the attached file
TOOL_DISCIPLINE = """\n\nIMPORTANT: Only call tools when genuinely required to complete the task. Do not call tools for simple conversational responses, greetings, or questions you can answer directly. When in doubt, respond in plain text first."""

http_client: httpx.AsyncClient = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(300.0, connect=10.0, read=120.0, write=30.0, pool=60.0),
        limits=httpx.Limits(max_connections=200, max_keepalive_connections=50),
        follow_redirects=True,
        http2=True,
    )
    print("[BRIDGE] HTTP client started - forwarding to LM Studio", file=sys.stderr, flush=True)
    try:
        await http_client.get(f"{LM_STUDIO_URL}/models", timeout=5.0)
        print(f"[BRIDGE] LM Studio reachable at {LM_STUDIO_URL}", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[BRIDGE] LM Studio not reachable: {e}", file=sys.stderr, flush=True)
    yield
    await http_client.aclose()
    print("[BRIDGE] HTTP client closed", file=sys.stderr, flush=True)

app = FastAPI(lifespan=lifespan)

@app.get("/health")
async def health():
    return {"status": "ok", "lm_studio": LM_STUDIO_URL, "version": "2.1.0-local"}

# === EXACT ORIGINAL convert_messages function (100% unchanged) ===
def convert_messages(body):
    msgs = []
    if "system" in body:
        system = body["system"]
        if isinstance(system, list):
            system = "\n".join(b.get("text", "") for b in system if isinstance(b, dict))
        system += TOOL_DISCIPLINE
        msgs.append({"role": "system", "content": system})

    for msg in body.get("messages", []):
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if isinstance(content, list):
            content = [b for b in content if isinstance(b, dict) and b.get("type") != "thinking"]
            tool_results = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_result"]
            tool_uses = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_use"]
            text_parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]

            if tool_uses and role == "assistant":
                msgs.append({
                    "role": "assistant",
                    "content": "\n".join(text_parts) if text_parts else None,
                    "tool_calls": [
                        {
                            "id": tu.get("id", "call_0"),
                            "type": "function",
                            "function": {
                                "name": tu.get("name", ""),
                                "arguments": json.dumps(tu.get("input", {}))
                            }
                        }
                        for tu in tool_uses
                    ]
                })
                continue

            if tool_results:
                for tr in tool_results:
                    tr_content = tr.get("content", "")
                    if isinstance(tr_content, list):
                        tr_content = "\n".join(b.get("text", "") for b in tr_content if isinstance(b, dict))
                    msgs.append({
                        "role": "tool",
                        "tool_call_id": tr.get("tool_use_id", "call_0"),
                        "content": tr_content
                    })
                if text_parts:
                    real_parts = [t for t in text_parts if not t.strip().startswith("<system-reminder")]
                    if real_parts:
                        msgs.append({"role": "user", "content": real_parts[-1].strip()})
                continue

            content = "\n".join(text_parts)

        msgs.append({"role": "assistant" if role == "assistant" else "user", "content": content})

    return msgs

# === EXACT ORIGINAL build_openai_body (adapted only for local LM Studio - no Nvidia mapping) ===
def build_openai_body(body, anthropic_model):
    openai_body = {
        "model": body.get("model", anthropic_model),   # pass through whatever cc-haha asks for
        "messages": convert_messages(body),
        "max_tokens": body.get("max_tokens", 4096),
        "temperature": body.get("temperature", 0.7),
        "stream": body.get("stream", False),
    }

    # Filter out Anthropic-native server tools (exact original logic)
    _NATIVE_TOOL_TYPES = frozenset({
        "web_search_20250305", "computer_20251022",
        "bash_20250124", "text_editor_20250124",
    })
    tools = body.get("tools", [])
    if tools:
        function_tools = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {}),
                },
            }
            for t in tools
            if t.get("type") not in _NATIVE_TOOL_TYPES
        ]
        if function_tools:
            openai_body["tools"] = function_tools
            openai_body["tool_choice"] = "auto"

    return openai_body

# === EXACT ORIGINAL /v1/messages endpoint (core logic that fixes usage.input_tokens) ===
@app.post("/v1/messages")
async def messages(request: Request):
    request_id = uuid.uuid4().hex[:8]
    anthropic_model = "unknown"
    try:
        body = await request.json()
        anthropic_model = body.get("model", "sonnet")
        stream = body.get("stream", False)

        print(f"[BRIDGE:{request_id}] model={anthropic_model} stream={stream} → LM Studio", file=sys.stderr)

        openai_body = build_openai_body(body, anthropic_model)
        api_url = f"{LM_STUDIO_URL}/chat/completions"
        headers = {"Content-Type": "application/json"}

        # Always force streaming upstream (exact original behaviour)
        openai_body["stream"] = True

        async def do_stream():
            msg_id = f"msg_{uuid.uuid4().hex[:12]}"
            yield f"event: message_start\ndata: {json.dumps({'type': 'message_start', 'message': {'id': msg_id, 'type': 'message', 'role': 'assistant', 'content': [], 'model': anthropic_model, 'usage': {'input_tokens': 0, 'output_tokens': 0}}})}\n\n"
            yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})}\n\n"

            full_content = ""
            tool_call_chunks = {}

            try:
                async with http_client.stream("POST", api_url, json=openai_body, headers=headers,
                                               timeout=httpx.Timeout(600.0)) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                                delta = chunk["choices"][0].get("delta", {}) or {}
                                text = delta.get("content") or ""
                                if text:
                                    full_content += text
                                    yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': text}})}\n\n"
                                for tc in delta.get("tool_calls", []) or []:
                                    idx = tc.get("index", 0)
                                    if idx not in tool_call_chunks:
                                        tool_call_chunks[idx] = {"id": tc.get("id", f"call_{idx}"), "name": "", "arguments": ""}
                                    if tc.get("function", {}).get("name"):
                                        tool_call_chunks[idx]["name"] += tc["function"]["name"]
                                    if tc.get("function", {}).get("arguments"):
                                        tool_call_chunks[idx]["arguments"] += tc["function"]["arguments"]
                            except Exception:
                                pass
            except Exception as e:
                print(f"[BRIDGE:{request_id}] Stream error: {e}", file=sys.stderr)

            yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': 0})}\n\n"

            if tool_call_chunks:
                for i, (idx, tc) in enumerate(tool_call_chunks.items(), start=1):
                    yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': i, 'content_block': {'type': 'tool_use', 'id': tc['id'], 'name': tc['name'], 'input': {}}})}\n\n"
                    yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': i, 'delta': {'type': 'input_json_delta', 'partial_json': tc['arguments']}})}\n\n"
                    yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': i})}\n\n"
                stop_reason = "tool_use"
            else:
                stop_reason = "end_turn"

            yield f"event: message_delta\ndata: {json.dumps({'type': 'message_delta', 'delta': {'stop_reason': stop_reason}, 'usage': {'input_tokens': 0, 'output_tokens': max(1, len(full_content) // 4)}})}\n\n"
            yield f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n"

        if stream:
            return StreamingResponse(
                do_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
            )
        else:
            # Non-stream fallback (exact original logic)
            full_text = ""
            tool_call_chunks = {}
            stop_reason = "end_turn"
            msg_id = f"msg_{uuid.uuid4().hex[:12]}"

            async for event in do_stream():
                line = event.decode() if isinstance(event, bytes) else event
                for part in line.split("\n"):
                    if not part.startswith("data: "):
                        continue
                    try:
                        data = json.loads(part[6:])
                        t = data.get("type", "")
                        if t == "content_block_start":
                            cb = data.get("content_block", {})
                            if cb.get("type") == "tool_use":
                                idx = data.get("index", 1) - 1
                                tool_call_chunks[idx] = {"id": cb["id"], "name": cb["name"], "arguments": ""}
                        elif t == "content_block_delta":
                            delta = data.get("delta", {})
                            if delta.get("type") == "text_delta":
                                full_text += delta.get("text", "")
                            elif delta.get("type") == "input_json_delta":
                                idx = data.get("index", 1) - 1
                                if idx in tool_call_chunks:
                                    tool_call_chunks[idx]["arguments"] += delta.get("partial_json", "")
                        elif t == "message_delta":
                            stop_reason = data.get("delta", {}).get("stop_reason", "end_turn")
                    except Exception:
                        pass

            content_blocks = []
            if tool_call_chunks:
                if full_text:
                    content_blocks.append({"type": "text", "text": full_text})
                for idx, tc in sorted(tool_call_chunks.items()):
                    try:
                        input_data = json.loads(tc["arguments"])
                    except Exception:
                        input_data = {}
                    content_blocks.append({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": input_data})
            else:
                content_blocks.append({"type": "text", "text": full_text})

            return JSONResponse(content={
                "id": msg_id, "type": "message", "role": "assistant",
                "content": content_blocks, "model": anthropic_model,
                "stop_reason": stop_reason,
                "usage": {"input_tokens": 0, "output_tokens": max(1, len(full_text) // 4)},
            })

    except Exception as e:
        import traceback
        print(f"[BRIDGE:{request_id}] ERROR: {e}\n{traceback.format_exc()[:500]}", file=sys.stderr)
        return JSONResponse(status_code=500, content={
            "id": f"msg_{request_id}", "type": "message", "role": "assistant",
            "content": [{"type": "text", "text": f"Bridge Error: {str(e)}"}],
            "model": anthropic_model, "stop_reason": "error",
        })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=BRIDGE_PORT, log_level="info")