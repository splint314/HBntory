"""
HBntory Product MCP Server.

Bridges the AI agent to the external Product API (see
docs/architecture_and_planning.md, "Serveur MCP Produit"). It exposes a
small, deliberately narrow set of read-only tools — the agent never talks
to the Product API directly, and this server never touches the local
database (stock lives in the Backoffice, not here).

Run:
    PRODUCT_API_URL=http://127.0.0.1:5001 python3 server.py

This uses the stdio transport, the standard way an MCP client launches a
local server as a subprocess.
"""

from typing import Optional

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import BaseModel, Field

from product_client import (
    ProductAPIError,
    ProductNotFoundError,
    get_product,
    list_products,
)
from stock_client import (
    BranchNotFoundError,
    StockAPIError,
    get_branches_with_product,
    get_stock_by_branch,
    list_branches,
)

mcp = FastMCP("hbntory-product")


class ProductSummary(BaseModel):
    """One catalog entry, as returned in a product listing."""

    id: int
    sku: str
    name: str
    category: str
    brand: str
    unit_price: float
    currency: str
    discontinued: bool


class ListProductsResult(BaseModel):
    count: int = Field(description="Total number of matching products, before pagination.")
    limit: int
    offset: int
    results: list[ProductSummary]


class ProductDetails(BaseModel):
    """Full catalog entry, as returned for a single product lookup."""

    id: int
    sku: str
    name: str
    description: str
    category: str
    brand: str
    supplier_id: str
    supplier_name: str
    unit_price: float
    currency: str
    discontinued: bool
    weight_kg: float
    tags: list[str]
    updated_at: str


@mcp.tool()
def list_products_tool(
    query: Optional[str] = None,
    category: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    include_discontinued: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> ListProductsResult:
    """
    List or search products in the supplier catalog.

    Use `query` for a free-text search over name, SKU, description, and
    tags. Use `category`, `min_price`, `max_price` to narrow results.
    Discontinued products are excluded unless include_discontinued=True.
    Results are paginated: `limit` (max 100) and `offset` control the page.

    This tool has NO branch filter and returns catalog data only, never
    stock quantities per branch. Do NOT use it to answer "what is in stock
    at branch X" — that would incorrectly present the whole catalog as
    that branch's stock. Use get_stock_by_branch_tool for any question
    about a specific branch's stock.
    """
    if limit < 1 or limit > 100:
        raise ToolError("limit must be between 1 and 100.")
    if offset < 0:
        raise ToolError("offset must be >= 0.")

    try:
        data = list_products(
            query=query,
            category=category,
            min_price=min_price,
            max_price=max_price,
            include_discontinued=include_discontinued,
            limit=limit,
            offset=offset,
        )
    except ProductAPIError as e:
        raise ToolError(f"Product catalog is currently unavailable: {e}") from e

    return ListProductsResult(
        count=data["count"],
        limit=data["limit"],
        offset=data["offset"],
        results=[ProductSummary(**item) for item in data["results"]],
    )


@mcp.tool()
def get_product_details(identifier: str) -> ProductDetails:
    """
    Get full details (description, price, brand, supplier, tags, ...) for
    exactly one product, looked up by its numeric id or its SKU (e.g.
    "HB-LAP-1001"). Raises a clear error if the product does not exist or
    the catalog is unreachable — never guess or invent product data.
    """
    identifier = identifier.strip()
    if not identifier:
        raise ToolError("identifier is required (a product id or SKU).")

    try:
        product = get_product(identifier)
    except ProductNotFoundError as e:
        raise ToolError(str(e)) from e
    except ProductAPIError as e:
        raise ToolError(f"Product catalog is currently unavailable: {e}") from e

    return ProductDetails(**product)


class StockItem(BaseModel):
    product_sku: str
    quantity: int


class BranchStockResult(BaseModel):
    branch_name: str
    items: list[StockItem]


class BranchQuantity(BaseModel):
    branch_name: str
    quantity: int


class ProductAvailabilityResult(BaseModel):
    product_sku: str
    branches: list[BranchQuantity]


@mcp.tool()
def list_branches_tool() -> list[str]:
    """List the names of every branch (physical store) in the system."""
    try:
        return list_branches()
    except StockAPIError as e:
        raise ToolError(f"Could not read branch data: {e}") from e


@mcp.tool()
def get_stock_by_branch_tool(branch_name: str) -> BranchStockResult:
    """
    Get the stock (product SKU + quantity, only items with quantity > 0)
    held in one branch, looked up by its exact name. Use list_branches_tool
    first if you are not sure of the exact branch name.

    This is the only correct tool for "what is in stock at branch X"
    questions. It only returns SKUs, not product names — if the question
    needs names too, call get_product_details for each SKU returned here.
    """
    branch_name = branch_name.strip()
    if not branch_name:
        raise ToolError("branch_name is required.")

    try:
        items = get_stock_by_branch(branch_name)
    except BranchNotFoundError as e:
        raise ToolError(str(e)) from e
    except StockAPIError as e:
        raise ToolError(f"Could not read stock data: {e}") from e

    return BranchStockResult(
        branch_name=branch_name,
        items=[StockItem(**item) for item in items],
    )


@mcp.tool()
def get_branches_with_product_tool(product_sku: str) -> ProductAvailabilityResult:
    """
    Get every branch that currently has stock (quantity > 0) of one
    product, looked up by its SKU (e.g. "HB-LAP-1001"). An empty
    `branches` list means the product exists but is out of stock
    everywhere (or the SKU is unknown) — this tool does not validate that
    the SKU exists in the catalog; use get_product_details for that.
    """
    product_sku = product_sku.strip()
    if not product_sku:
        raise ToolError("product_sku is required.")

    try:
        branches = get_branches_with_product(product_sku)
    except StockAPIError as e:
        raise ToolError(f"Could not read stock data: {e}") from e

    return ProductAvailabilityResult(
        product_sku=product_sku,
        branches=[BranchQuantity(**item) for item in branches],
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
