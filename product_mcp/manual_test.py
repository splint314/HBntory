"""
Manual sanity check for the Product MCP server's tools (Task 4, exercise 3).

Not an automated test suite: calls the tools exactly as the MCP tool
manager would (arguments in, CallToolResult/ToolError out), so it
validates the same code path a real MCP client hits, without needing a
full client/stdio round trip.

Requires the Product API running, e.g.:
    cd product_api && HBN_PRODUCTS_PORT=5001 python3 app.py

Run:
    PRODUCT_API_URL=http://127.0.0.1:5001 python3 manual_test.py
"""

import asyncio

from mcp.server.fastmcp.exceptions import ToolError

from server import mcp


async def call(name, **kwargs):
    try:
        result = await mcp.call_tool(name, kwargs)
        print(f"OK   {name}({kwargs}) ->")
        print(" ", result)
    except ToolError as e:
        print(f"ERR  {name}({kwargs}) -> ToolError: {e}")
    print()


async def main():
    print("--- 1. Successful product listing ---")
    await call("list_products_tool", query="laptop", limit=3)

    print("--- 2. Product detail retrieval ---")
    await call("get_product_details", identifier="HB-LAP-1001")

    print("--- 3. Product not found ---")
    await call("get_product_details", identifier="does-not-exist")

    print("--- 4. Invalid input (out-of-range limit) ---")
    await call("list_products_tool", limit=0)

    print("--- 5. Product API connection error (point PRODUCT_API_URL at nothing) ---")
    import product_client
    original_url = product_client.PRODUCT_API_URL
    product_client.PRODUCT_API_URL = "http://127.0.0.1:1"
    await call("get_product_details", identifier="HB-LAP-1001")
    await call("list_products_tool")
    product_client.PRODUCT_API_URL = original_url


if __name__ == "__main__":
    asyncio.run(main())
