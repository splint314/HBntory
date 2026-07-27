"""
The AI agent: turns one natural-language question into one answer, using a
local Ollama model's tool-calling to call the Product MCP server's tools
(see docs/architecture_and_planning.md §1.3/1.6).

Runs against a local Ollama server (http://localhost:11434 by default)
instead of a paid hosted API — chosen so the project has zero ongoing
cost. Trade-off: a small local model (llama3.2, 3B) follows the "never
invent data" / scope-limiting instructions less reliably than a frontier
model — see docs/architecture_and_planning.md §2.4 for the full
justification.

One call to answer_question() = one independent question, no conversation
history kept across requests (matches the "no history required" choice in
§2.2 of the architecture doc).
"""

import json
import logging
import os

import httpx

from mcp_client import MCPConnectionError, product_mcp_session

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
MODEL = os.getenv("AI_MODEL", "llama3.2")
MAX_TOOL_TURNS = 8
# Local CPU inference is much slower than a hosted API, and Ollama unloads
# an idle model from memory after a few minutes — the first request after
# a gap pays a cold-start reload on top of generation. Generous timeout to
# cover that; a "warm-up" question before a live demo avoids the wait.
REQUEST_TIMEOUT_SECONDS = 240

logger = logging.getLogger("hbntory.agent")

# Task 5.1: the question types this service is built to answer. Anything
# else, the agent is instructed to decline rather than improvise — see the
# last rule in SYSTEM_PROMPT and ai_service/README.md for the full list.
SYSTEM_PROMPT = """\
You are the HBntory shopping assistant. You answer questions from anonymous \
website visitors, strictly limited to these supported question types:
1. Details about a specific product (name, description, price, brand, ...).
2. Which branch(es) have stock of a given product.
3. Which products are available in a given branch.
4. Whether a shopping list (products + desired quantities) can be satisfied \
by one branch, and if so which one(s) — check each item's quantity against \
each branch's actual stock via the tools, don't just check availability.

Rules:
- Always use the provided tools to look up product and stock information. \
Never invent a product, price, description, or stock quantity.
- If a tool reports a product or branch does not exist, or a system is \
unavailable, say so plainly instead of guessing.
- If the available tools cannot answer the question, say the information \
is unavailable rather than making something up.
- If the question is not one of the 4 supported types above (e.g. general \
chit-chat, requests unrelated to products/stock, or anything requiring \
data no tool provides), say clearly that it is outside what you can help \
with — do not attempt to answer it anyway.
- Keep answers short and to the point, in the same language as the question.
"""


class AgentError(Exception):
    """The agent could not produce an answer (LLM or MCP failure)."""


def _unwrap(exc: BaseException) -> BaseException:
    """Pull the real exception out of an anyio TaskGroup's wrapping.

    anyio's TaskGroup (inside product_mcp_session's nested `async with`
    blocks) wraps any exception raised past `yield session` into a
    single-item ExceptionGroup during its own cleanup — a plain
    `except AgentError` would silently fail to match that group.
    """
    while isinstance(exc, BaseExceptionGroup) and len(exc.exceptions) == 1:
        exc = exc.exceptions[0]
    return exc


def _mcp_tools_to_ollama(mcp_tools) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description or "",
                "parameters": tool.inputSchema,
            },
        }
        for tool in mcp_tools
    ]


def _tool_result_text(result) -> str:
    texts = [
        block.text for block in result.content if hasattr(block, "text")
    ]
    return "\n".join(texts) if texts else json.dumps(
        result.structuredContent or {}
    )


async def answer_question(question: str) -> str:
    """Run one question through the loop, return the final answer text."""
    try:
        async with product_mcp_session() as session:
            mcp_tools = (await session.list_tools()).tools
            tools = _mcp_tools_to_ollama(mcp_tools)

            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": question},
            ]

            timeout = REQUEST_TIMEOUT_SECONDS
            async with httpx.AsyncClient(timeout=timeout) as http:
                for _ in range(MAX_TOOL_TURNS):
                    try:
                        response = await http.post(
                            f"{OLLAMA_HOST}/api/chat",
                            json={
                                "model": MODEL,
                                "messages": messages,
                                "tools": tools,
                                "stream": False,
                                # Keep the model resident between requests
                                # so a demo's questions don't each pay a
                                # cold-start reload.
                                "keep_alive": "30m",
                            },
                        )
                        response.raise_for_status()
                    except httpx.ConnectError as e:
                        raise AgentError(
                            f"Ollama is not reachable at {OLLAMA_HOST}: {e}"
                        ) from e
                    except httpx.HTTPError as e:
                        raise AgentError(
                            f"The language model is unavailable: {e}"
                        ) from e

                    message = response.json()["message"]
                    messages.append(message)

                    tool_calls = message.get("tool_calls")
                    if not tool_calls:
                        text = (message.get("content") or "").strip()
                        return text or "I could not answer this question."

                    for i, call in enumerate(tool_calls):
                        name = call["function"]["name"]
                        args = call["function"]["arguments"]
                        call_id = call.get("id") or f"call_{i}"
                        logger.info("tool call: %s(%s)", name, args)
                        try:
                            result = await session.call_tool(name, args)
                            result_text = _tool_result_text(result)
                            logger.info(
                                "tool result: %s -> isError=%s %.200s",
                                name, result.isError, result_text,
                            )
                        except Exception as e:
                            result_text = f"Tool call failed: {e}"
                            logger.info("tool call failed: %s -> %s", name, e)
                        messages.append({
                            "role": "tool",
                            "content": result_text,
                            "tool_call_id": call_id,
                        })

            raise AgentError(
                "The agent used too many tool calls without reaching "
                "an answer."
            )
    except Exception as exc:
        real = _unwrap(exc)
        if isinstance(real, AgentError):
            raise real from exc
        if isinstance(real, MCPConnectionError):
            raise AgentError(
                f"The product/stock lookup service is unavailable: {real}"
            ) from real
        raise
