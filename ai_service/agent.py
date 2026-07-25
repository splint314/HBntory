"""
The AI agent: turns one natural-language question into one answer, using
Claude's tool use to call the Product MCP server's tools (see
docs/architecture_and_planning.md §1.3/1.6).

One call to answer_question() = one independent question, no conversation
history kept across requests (matches the "no history required" choice in
§2.2 of the architecture doc).
"""

import json
import logging
import os

import anthropic

from mcp_client import MCPConnectionError, product_mcp_session

MODEL = os.getenv("AI_MODEL", "claude-sonnet-5")
MAX_TOOL_TURNS = 8

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


def _mcp_tools_to_anthropic(mcp_tools) -> list[dict]:
    return [
        {
            "name": tool.name,
            "description": tool.description or "",
            "input_schema": tool.inputSchema,
        }
        for tool in mcp_tools
    ]


def _tool_result_text(result) -> str:
    texts = [block.text for block in result.content if hasattr(block, "text")]
    return "\n".join(texts) if texts else json.dumps(result.structuredContent or {})


async def answer_question(question: str) -> str:
    """Run one question through the agent loop and return the final answer text."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise AgentError("ANTHROPIC_API_KEY is not set.")

    try:
        client = anthropic.Anthropic()
    except Exception as e:
        raise AgentError(f"Could not initialize the Anthropic client: {e}") from e

    try:
        async with product_mcp_session() as session:
            mcp_tools = (await session.list_tools()).tools
            tools = _mcp_tools_to_anthropic(mcp_tools)

            messages = [{"role": "user", "content": question}]

            for _ in range(MAX_TOOL_TURNS):
                try:
                    response = client.messages.create(
                        model=MODEL,
                        max_tokens=1024,
                        system=SYSTEM_PROMPT,
                        tools=tools,
                        messages=messages,
                    )
                except anthropic.APIError as e:
                    raise AgentError(f"The language model is unavailable: {e}") from e

                messages.append({"role": "assistant", "content": response.content})

                if response.stop_reason != "tool_use":
                    text_blocks = [
                        block.text for block in response.content
                        if block.type == "text"
                    ]
                    return "\n".join(text_blocks).strip() or (
                        "I could not produce an answer for this question."
                    )

                tool_results = []
                for block in response.content:
                    if block.type != "tool_use":
                        continue
                    logger.info("tool call: %s(%s)", block.name, block.input)
                    try:
                        result = await session.call_tool(block.name, block.input)
                        result_text = _tool_result_text(result)
                        logger.info(
                            "tool result: %s -> isError=%s %.200s",
                            block.name, result.isError, result_text,
                        )
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result_text,
                            "is_error": result.isError,
                        })
                    except Exception as e:
                        logger.info("tool call failed: %s -> %s", block.name, e)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": f"Tool call failed: {e}",
                            "is_error": True,
                        })
                messages.append({"role": "user", "content": tool_results})

            raise AgentError(
                "The agent used too many tool calls without reaching an answer."
            )
    except MCPConnectionError as e:
        raise AgentError(f"The product/stock lookup service is unavailable: {e}") from e
