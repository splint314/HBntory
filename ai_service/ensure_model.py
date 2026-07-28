"""
Run once at container startup: make sure OLLAMA_HOST already has AI_MODEL
pulled, pulling it if not.

Without this, a fresh deployment's /api/ask silently 503s until someone
remembers to run `ollama pull` by hand (see README.md "Known limitations").
Blocks until the pull completes (can take several minutes for an 8B model
on first run) so the app only starts serving once the model is usable.
"""

import json
import os
import sys

import httpx

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
MODEL = os.getenv("AI_MODEL", "llama3.1:8b")
STARTUP_TIMEOUT_SECONDS = 600


def _model_present(client: httpx.Client) -> bool:
    response = client.get(f"{OLLAMA_HOST}/api/tags", timeout=10)
    response.raise_for_status()
    names = {model["name"] for model in response.json().get("models", [])}
    # Ollama normalizes "llama3.1:8b" and "llama3.1" differently depending
    # on tag presence; a prefix match on the untagged name is good enough
    # here to avoid re-pulling a model that's already there under a
    # slightly different tag spelling.
    return MODEL in names or any(name.split(":")[0] == MODEL.split(":")[0] for name in names)


def main() -> None:
    with httpx.Client() as client:
        try:
            if _model_present(client):
                print(f"ensure_model: {MODEL!r} already present on {OLLAMA_HOST}.")
                return
        except httpx.HTTPError as e:
            print(
                f"ensure_model: could not reach Ollama at {OLLAMA_HOST} ({e}); "
                "starting the app anyway, /api/ask will report it as unavailable.",
                file=sys.stderr,
            )
            return

        print(f"ensure_model: pulling {MODEL!r} from {OLLAMA_HOST} (first run only)...")
        with client.stream(
            "POST", f"{OLLAMA_HOST}/api/pull",
            json={"model": MODEL},
            timeout=STARTUP_TIMEOUT_SECONDS,
        ) as response:
            response.raise_for_status()
            # Ollama reports a bad model name as HTTP 200 with an "error"
            # field inside the streamed JSON, not as an HTTP error status —
            # every line must be checked, not just the response code.
            for line in response.iter_lines():
                if not line:
                    continue
                event = json.loads(line)
                if "error" in event:
                    print(
                        f"ensure_model: failed to pull {MODEL!r}: {event['error']}; "
                        "starting the app anyway, /api/ask will report it as unavailable.",
                        file=sys.stderr,
                    )
                    return
        print(f"ensure_model: {MODEL!r} pulled successfully.")


if __name__ == "__main__":
    main()
