import json
import difflib
import random
from pathlib import Path
from typing import Dict, Any

from flask import Flask, render_template, request, jsonify

app = Flask(__name__, static_folder="static", template_folder="templates")

DATA_FILE = Path(__file__).parent / "data" / "events.txt"


def _load_local_events() -> list[Dict[str, Any]]:
    if not DATA_FILE.exists():
        return []

    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        random.shuffle(data)
        return data
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to load local events: {exc}")
        return []

LOCAL_EVENTS = _load_local_events()

LOCAL_EVENTS = _load_local_events()


def _normalize(s: str) -> str:
    return "".join(ch for ch in s.lower().strip() if ch.isalnum() or ch.isspace())


def _fuzzy_match(a: str, b: str, threshold=0.78) -> bool:
    return difflib.SequenceMatcher(None, _normalize(a), _normalize(b)).ratio() >= threshold


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

    if not LOCAL_EVENTS:
        return jsonify({"ok": False, "error": "no events available"}), 500

    if amount <= len(LOCAL_EVENTS):
        events = random.sample(LOCAL_EVENTS, amount)
    else:
        events = random.choices(LOCAL_EVENTS, k=amount)

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
