import os
import json
import difflib
from typing import Dict, Any

from flask import Flask, render_template, request, jsonify
from openai import OpenAI

app = Flask(__name__, static_folder="static", template_folder="templates")

# --- OpenAI Client ---
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = os.getenv("HISTORY_WORDLE_MODEL", "gpt-4.1-mini")

SYSTEM_PROMPT = """
You are a historical game content generator.
Return STRICT JSON describing one well-known historical event matching the requested theme.

Schema:
{
  "event_title": "string",
  "date": "YYYY-MM-DD or YYYY-MM or YYYY",
  "country_or_region": "string",
  "domain": "string",
  "accepted_answers": ["list of strings"],
  "clues": {
    "1_date": "clue",
    "2_geo_domain": "clue",
    "3_vague_headline": "clue",
    "4_redacted_headline": "clue",
    "5_almost_full_headline": "clue"
  }
}

Rules:
- The event must strongly fit the theme.
- 'accepted_answers' must include common phrasings.
- Clue 1 = date only.
- Clue 2 = geographic region + domain, no names.
- Clue 3 = vague headline with anonymized names.
- Clue 4 = headline with exactly one key noun redacted "_____".
- Clue 5 = almost full headline, minor detail hidden.
Return ONLY the JSON with no surrounding text.
"""


def _normalize(s: str) -> str:
    return "".join(ch for ch in s.lower().strip() if ch.isalnum() or ch.isspace())


def _fuzzy_match(a: str, b: str, threshold=0.78) -> bool:
    return difflib.SequenceMatcher(None, _normalize(a), _normalize(b)).ratio() >= threshold


def get_event(theme: str) -> Dict[str, Any]:
    user_prompt = f"Pick ONE famous historical event for the theme '{theme}'. Return ONLY the JSON object."

    resp = client.chat.completions.create(
        model=MODEL,
        temperature=0.7,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )

    txt = resp.choices[0].message.content.strip()
    if txt.startswith("```"):
        txt = txt.strip("`")
        if txt.lower().startswith("json"):
            txt = txt[4:].strip()
    data = json.loads(txt)

    for k in ["event_title", "date", "country_or_region", "domain", "accepted_answers", "clues"]:
        if k not in data:
            raise ValueError(f"Missing key: {k}")

    return data


def check_guess(guess: str, event: Dict[str, Any]) -> bool:
    answers = [event["event_title"]] + event.get("accepted_answers", [])
    return any(_fuzzy_match(guess, a) for a in answers)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/batch_events", methods=["POST"])
def api_batch_events():
    payload = request.get_json(force=True)
    theme = payload.get("theme", "Global")
    amount = int(payload.get("amount", 3))
    events = []

    for _ in range(amount):
        try:
            events.append(get_event(theme))
        except Exception as e:
            print(e)
            return jsonify({"ok": False, "error": "batch generation failed"}), 500

    return jsonify({"ok": True, "events": events})


@app.route("/api/guess", methods=["POST"])
def api_guess():
    payload = request.get_json(force=True)
    guess = payload.get("guess", "")
    event = payload.get("event")
    clue_number = int(payload.get("clue_number", 1))

    if not guess or not event:
        return jsonify({"ok": False, "error": "Missing guess or event"}), 400

    correct = check_guess(guess, event)
    score = max(6 - clue_number, 1) if correct else 0
    return jsonify({"ok": True, "correct": correct, "score": score})


if __name__ == "__main__":
    app.run(debug=True)
