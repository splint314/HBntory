"""
The AI agent: turns one natural-language question into one answer, using
Claude's tool use to call the Product MCP server's tools (see
docs/architecture_and_planning.md §1.3/1.6).

One call to answer_question() = one independent question, no conversation
history kept across requests (matches the "no history required" choice in
§2.2 of the architecture doc).
"""

import json
import os

import anthropic

from mcp_client import MCPConnectionError, product_mcp_session

MODEL = os.getenv("AI_MODEL", "claude-sonnet-5")
MAX_TOOL_TURNS = 8

SYSTEM_PROMPT = """\
You are the HBntory shopping assistant. You answer questions from anonymous \
website visitors about the product catalog and which branches have stock.

Rules:
- Always use the provided tools to look up product and stock information. \
Never invent a product, price, description, or stock quantity.
- If a tool reports a product or branch does not exist, or a system is \
unavailable, say so plainly instead of guessing.
- If the available tools cannot answer the question, say the information \
is unavailable rather than making something up.
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
                    try:
                        result = await session.call_tool(block.name, block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": _tool_result_text(result),
                            "is_error": result.isError,
                        })
                    except Exception as e:
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
