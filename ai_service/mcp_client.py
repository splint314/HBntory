"""
Thin wrapper around the MCP Python SDK to talk to the Product MCP server
(product_mcp/) as a standard MCP client, over stdio (see
docs/architecture_and_planning.md §2.3).

The AI Query Service never calls the Product API or the Backoffice
database directly — every piece of product/stock data goes through this
MCP session, so the MCP server stays the single source of truth for what
the agent is allowed to see.
"""

import os
from contextlib import asynccontextmanager

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Path to the product_mcp venv's python and server.py. Defaults assume the
# standard repo layout (ai_service/ and product_mcp/ as siblings).
PRODUCT_MCP_PYTHON = os.getenv(
    "PRODUCT_MCP_PYTHON",
    os.path.join(
        os.path.dirname(__file__), "..", "product_mcp", ".venv", "bin", "python"
    ),
)
PRODUCT_MCP_SERVER = os.getenv(
    "PRODUCT_MCP_SERVER",
    os.path.join(os.path.dirname(__file__), "..", "product_mcp", "server.py"),
)


class MCPConnectionError(Exception):
    """The Product MCP server could not be started or initialized."""


@asynccontextmanager
async def product_mcp_session():
    """
    Launch the Product MCP server as a subprocess and yield a ready,
    initialized ClientSession. PRODUCT_API_URL and DATABASE_URL (needed by
    the server's product/stock tools) are forwarded from this process's
    environment.
    """
    server_env = {}
    if "PRODUCT_API_URL" in os.environ:
        server_env["PRODUCT_API_URL"] = os.environ["PRODUCT_API_URL"]
    if "DATABASE_URL" in os.environ:
        server_env["DATABASE_URL"] = os.environ["DATABASE_URL"]

    params = StdioServerParameters(
        command=PRODUCT_MCP_PYTHON,
        args=[PRODUCT_MCP_SERVER],
        env=server_env,
    )

    try:
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session
    except OSError as e:
        raise MCPConnectionError(
            f"Could not start the Product MCP server "
            f"({PRODUCT_MCP_PYTHON} {PRODUCT_MCP_SERVER}): {e}"
        ) from e
