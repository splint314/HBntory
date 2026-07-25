"""
Manual sanity check for the AI Query Service (Task 5/6).

Two parts:
1. MCP connectivity: launches the Product MCP server and lists/calls its
   tools directly. No LLM involved, no Ollama server needed — this part
   always runs and is what CI/a teammate without Ollama installed can
   verify.
2. Full agent loop: asks the agent a handful of realistic questions.
   Skipped with a clear message if the local Ollama server isn't
   reachable (see OLLAMA_HOST).

Requires the Product API running (see product_api/) and the Backoffice
database seeded (see backoffice/seed.py) for the stock questions to have
real data to find.

Run:
    PRODUCT_API_URL=http://127.0.0.1:5001 \\
    DATABASE_URL="sqlite:///../backoffice/hbntory.db" \\
    .venv/bin/python manual_test.py
"""

import asyncio
import os

import httpx

from mcp_client import product_mcp_session


async def check_mcp_connectivity():
    print("--- 1. Product MCP server connectivity ---")
    async with product_mcp_session() as session:
        tools = (await session.list_tools()).tools
        names = sorted(tool.name for tool in tools)
        print("Tools exposed:", names)
        assert "list_products_tool" in names
        assert "get_product_details" in names
        assert "get_stock_by_branch_tool" in names
        assert "get_branches_with_product_tool" in names

        result = await session.call_tool("list_products_tool", {"limit": 1})
        print("list_products_tool(limit=1) isError:", result.isError)

        result = await session.call_tool(
            "get_product_details", {"identifier": "does-not-exist"}
        )
        print("get_product_details(unknown) isError:", result.isError)
    print("MCP connectivity: OK\n")


EXAMPLE_QUESTIONS = [
    "Quels sont les détails du produit HB-LAP-1001 ?",
    "Quelles branches ont du stock du produit HB-KBD-4102 ?",
    "Quels produits sont disponibles dans la branche Lyon ?",
    "J'ai besoin de 5 claviers HB-KBD-4102, une branche peut-elle fournir cette quantité ?",
    "As-tu du stock pour un produit qui n'existe pas, XYZ-0000 ?",
    "Quelle est la météo à Paris aujourd'hui ?",  # out of scope, should be declined
]


async def check_agent():
    ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    try:
        httpx.get(f"{ollama_host}/api/tags", timeout=3).raise_for_status()
    except httpx.HTTPError:
        print(
            f"--- 2. Full agent loop: SKIPPED (Ollama not reachable at "
            f"{ollama_host}) ---"
        )
        return

    from agent import AgentError, answer_question

    print("--- 2. Full agent loop ---")
    for question in EXAMPLE_QUESTIONS:
        print(f"\nQ: {question}")
        try:
            print("A:", await answer_question(question))
        except AgentError as e:
            print("AgentError:", e)


async def main():
    await check_mcp_connectivity()
    await check_agent()


if __name__ == "__main__":
    asyncio.run(main())
