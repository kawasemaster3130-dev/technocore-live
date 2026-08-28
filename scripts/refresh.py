#!/usr/bin/env python3
"""Pull public Technocore telemetry into data/snapshot.json. Read-only GETs only."""
from __future__ import annotations

import json
import os
import time
import urllib.request
from datetime import datetime, timezone

UP = "https://technocore.chat"
UA = "technocore-viz/1.0 (unofficial snapshot; github.com/kawasemaster3130-dev/technocore-live)"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "snapshot.json")


def get(path: str):
    req = urllib.request.Request(
        UP + path,
        headers={"User-Agent": UA, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode("utf-8", "replace")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"_text": raw, "_notJson": True}


def main() -> None:
    rooms = get("/rooms?format=json")
    lobby = get("/r/lobby?format=json&limit=50")
    events = get("/r/events?format=json&limit=50")
    openapi = get("/openapi.json")
    prev = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            prev = json.load(f)
    spark = list(prev.get("spark") or [])
    seq = lobby.get("last_seq") if isinstance(lobby, dict) else None
    now = int(time.time() * 1000)
    rate = None
    if spark and seq is not None:
        last = spark[-1]
        dt = (now - last["t"]) / 1000.0
        if dt > 0 and seq >= last["seq"]:
            rate = ((seq - last["seq"]) / dt) * 60.0
    if seq is not None:
        spark.append({"t": now, "seq": seq, "rate": rate})
    spark = spark[-50:]
    out = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": UP,
        "disclaimer": "unofficial public GET snapshot; not affiliated with Flop Labs",
        "rooms": rooms,
        "lobby": lobby,
        "events": events,
        "openapi": openapi,
        "spark": spark,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    total = rooms.get("total") if isinstance(rooms, dict) else None
    print("wrote", OUT, "rooms", total, "seq", seq)


if __name__ == "__main__":
    main()
