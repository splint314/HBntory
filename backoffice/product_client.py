"""
Client for the external Product API (read-only supplier catalog).

Centralizes every HTTP call to the Product API so both the stock validation
rules (validation.py) and the Backoffice product-browsing routes (app.py)
share the same request/error-handling logic instead of duplicating it.

Never raises on a network problem: the Product API is an external
dependency that can be slow or unavailable, and callers must be able to
tell "does not exist" apart from "could not check" without a crash.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

PRODUCT_API_URL = os.getenv("PRODUCT_API_URL", "http://localhost:5001")


def _get(path: str, params: dict | None = None) -> dict | None:
    """
    GET a JSON endpoint of the Product API.

    Returns the parsed body, or None if the resource does not exist (404),
    the API is unreachable, or it responds with anything unexpected.
    """
    url = f"{PRODUCT_API_URL}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError:
        # 404 = does not exist. Any other status = reject to be safe.
        return None
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def get_product(sku: str) -> dict | None:
    """Fetch one product's full details by SKU/id. None if unavailable."""
    return _get(f"/api/v1/products/{sku}")


def list_products(
    q: str | None = None, limit: int = 20, offset: int = 0
) -> dict:
    """
    List/search the catalog.

    Degrades to an empty result set if the API is unreachable: browsing
    the catalog from the Backoffice must never crash on a network hiccup.
    """
    params = {"limit": limit, "offset": offset}
    if q:
        params["q"] = q
    data = _get("/api/v1/products", params)
    if data is None:
        return {"count": 0, "limit": limit, "offset": offset, "results": []}
    return data
