"""
Read-only product catalog for the public client web page.

Combines the Product MCP server's stock tools (per-branch stock) and
product tools (catalog details) into one structure the client can render
directly — no MCP knowledge, no per-product round trip from the browser.
Same MCP session as the agent (see mcp_client.py): this never touches the
Product API or the Backoffice database directly.
"""

import json

from mcp_client import product_mcp_session


class CatalogError(Exception):
    """The catalog could not be built (MCP or tool failure)."""


def _result_data(result):
    if result.isError:
        text = "\n".join(
            block.text for block in result.content if hasattr(block, "text")
        )
        raise CatalogError(text or "tool call failed")
    if result.structuredContent is not None:
        return result.structuredContent
    texts = [block.text for block in result.content if hasattr(block, "text")]
    return json.loads(texts[0]) if texts else {}


async def get_catalog() -> dict:
    """
    Return {"branches": [{"name": str, "items": [{"sku", "name",
    "category", "brand", "unit_price", "currency", "quantity"}, ...]}]}.

    Only products with stock (quantity > 0) in a branch appear there —
    same rule the stock tools already apply.
    """
    async with product_mcp_session() as session:
        # FastMCP wraps a bare (non-object) return type — list_branches_tool
        # returns list[str] — as {"result": [...]} in structuredContent;
        # object-returning tools (below) come back unwrapped. Confirmed
        # empirically, not documented in product_mcp/README.md.
        branches_raw = await _call(session, "list_branches_tool", {})
        branch_names = (
            branches_raw["result"]
            if isinstance(branches_raw, dict)
            else branches_raw
        )

        stock_by_branch = []
        for name in branch_names:
            data = await _call(
                session, "get_stock_by_branch_tool", {"branch_name": name}
            )
            stock_by_branch.append((name, data["items"]))

        skus = {
            item["product_sku"]
            for _, items in stock_by_branch
            for item in items
        }
        details = {}
        for sku in skus:
            try:
                details[sku] = await _call(
                    session, "get_product_details", {"identifier": sku}
                )
            except CatalogError:
                details[sku] = None

        branches = []
        for name, items in stock_by_branch:
            catalog_items = []
            for item in items:
                sku = item["product_sku"]
                info = details.get(sku)
                catalog_items.append({
                    "sku": sku,
                    "quantity": item["quantity"],
                    "name": info["name"] if info else sku,
                    "category": info["category"] if info else None,
                    "brand": info["brand"] if info else None,
                    "unit_price": info["unit_price"] if info else None,
                    "currency": info["currency"] if info else None,
                })
            catalog_items.sort(key=lambda i: i["name"])
            branches.append({"name": name, "items": catalog_items})

        return {"branches": branches}


async def _call(session, tool_name: str, args: dict):
    result = await session.call_tool(tool_name, args)
    return _result_data(result)
