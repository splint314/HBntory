"""
HTTP client for the external Product API, used by the MCP server.

Unlike backoffice/product_client.py (which degrades silently so a flaky
Product API never crashes the Backoffice UI), this client raises distinct,
typed exceptions for every failure mode. The MCP tools in server.py catch
them and turn them into clear, structured information for the AI agent —
the agent must be able to tell "no such product" apart from "the catalog
service is unreachable" instead of getting an empty result either way.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

PRODUCT_API_URL = os.getenv("PRODUCT_API_URL", "http://localhost:5001")
REQUEST_TIMEOUT_SECONDS = 5


class ProductAPIError(Exception):
    """The Product API could not be reached or returned an unexpected response."""


class ProductNotFoundError(Exception):
    """The requested product id/SKU does not exist in the catalog."""


def _get(path: str, params: dict | None = None) -> dict:
    """
    GET a JSON endpoint of the Product API.

    Raises ProductAPIError for anything that is not a clean 200 JSON body,
    except a 404 which is left to the caller to interpret (only
    /api/v1/products/<id> uses 404 to mean "not found"; every other
    endpoint should never 404 under normal use).
    """
    url = f"{PRODUCT_API_URL}{path}"
    if params:
        # Drop None values instead of sending the literal string "None".
        params = {k: v for k, v in params.items() if v is not None}
        url += "?" + urllib.parse.urlencode(params)

    try:
        with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise
        detail = e.read().decode("utf-8", errors="replace") if e.fp else ""
        raise ProductAPIError(
            f"Product API returned HTTP {e.code} for {path}: {detail[:200]}"
        ) from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise ProductAPIError(
            f"Could not reach the Product API at {PRODUCT_API_URL}: {e}"
        ) from e

    try:
        return json.loads(body)
    except ValueError as e:
        raise ProductAPIError(
            f"Product API returned invalid JSON for {path}: {e}"
        ) from e


def list_products(
    query: str | None = None,
    category: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    include_discontinued: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """
    List/search the catalog. Returns the API's paginated envelope:
    {"count": int, "limit": int, "offset": int, "results": [product, ...]}.

    Raises ProductAPIError if the Product API is unreachable or errors.
    """
    params = {
        "q": query,
        "category": category,
        "min_price": min_price,
        "max_price": max_price,
        "include_discontinued": "true" if include_discontinued else "false",
        "limit": limit,
        "offset": offset,
    }
    return _get("/api/v1/products", params)


def get_product(identifier: str) -> dict:
    """
    Fetch one product's full details by id or SKU.

    Raises ProductNotFoundError if no such product exists, or
    ProductAPIError if the Product API is unreachable or errors.
    """
    try:
        return _get(f"/api/v1/products/{urllib.parse.quote(identifier)}")
    except urllib.error.HTTPError as e:
        raise ProductNotFoundError(
            f"No product found for id/SKU {identifier!r}."
        ) from e
