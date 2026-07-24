/*
 * HBntory public client interface. Plain fetch() against the AI Query
 * Service's REST API, no build step, no framework, no authentication
 * (see docs/architecture_and_planning.md §2.2).
 */

// Override at runtime with ?api=http://host:port if the service isn't on
// the default port on the same host the page was opened from.
const AI_SERVICE_URL =
  new URLSearchParams(window.location.search).get("api") ||
  "http://127.0.0.1:5002";

const form = document.getElementById("ask-form");
const input = document.getElementById("question");
const submitBtn = document.getElementById("submit-btn");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const answerEl = document.getElementById("answer");

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) return;

  hide(errorEl);
  hide(answerEl);
  show(loadingEl);
  submitBtn.disabled = true;

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    const isJson = response.headers.get("content-type")?.includes("json");
    const body = isJson ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      const message = body?.message || `La requête a échoué (${response.status}).`;
      throw new Error(message);
    }

    answerEl.textContent = body.answer;
    show(answerEl);
  } catch (err) {
    const message = err instanceof TypeError
      ? "Impossible de joindre le service. Vérifiez qu'il est bien démarré."
      : err.message;
    errorEl.textContent = message;
    show(errorEl);
  } finally {
    hide(loadingEl);
    submitBtn.disabled = false;
  }
});
