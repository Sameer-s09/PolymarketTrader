"""
Persistent journal for the BTC Fade signal detector.
Append-only JSONL at data/fade_journal.jsonl — each line is one Signal record.
Thread-safe via a single RLock.
"""
import json
import os
import threading
from dataclasses import asdict
from typing import Optional

from signal_detector import Signal

JOURNAL_FILE = os.path.join(os.path.dirname(__file__), "data", "fade_journal.jsonl")


class JournalStore:
    def __init__(self, path: str = JOURNAL_FILE):
        self._path = path
        self._lock = threading.RLock()
        self._records: dict[str, dict] = {}
        self._load()

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self) -> None:
        if not os.path.exists(self._path):
            return
        with open(self._path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        rec = json.loads(line)
                        self._records[rec["signal_id"]] = rec
                    except (json.JSONDecodeError, KeyError):
                        pass

    def _save_all(self) -> None:
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        sorted_recs = sorted(self._records.values(), key=lambda r: r["signal_time"])
        with open(self._path, "w", encoding="utf-8") as f:
            for rec in sorted_recs:
                f.write(json.dumps(rec) + "\n")

    # ── Public API ────────────────────────────────────────────────────────────

    def add(self, signal: Signal) -> bool:
        """Add a new signal. Returns False if already exists (idempotent)."""
        with self._lock:
            if signal.signal_id in self._records:
                return False
            self._records[signal.signal_id] = asdict(signal)
            self._save_all()
            return True

    def update(self, signal: Signal) -> None:
        """Overwrite record with resolved outcome data."""
        with self._lock:
            self._records[signal.signal_id] = asdict(signal)
            self._save_all()

    def get_pending(self) -> list[Signal]:
        """Return signals with an entry price but no result yet."""
        with self._lock:
            out = []
            for rec in self._records.values():
                if rec.get("entry_price") is not None and rec.get("result") is None:
                    out.append(Signal(**rec))
            return out

    def get_all(self, limit: Optional[int] = None) -> list[dict]:
        """Return all records newest-first."""
        with self._lock:
            recs = sorted(self._records.values(),
                          key=lambda r: r["signal_time"], reverse=True)
            return recs[:limit] if limit else recs

    def stats(self) -> dict:
        """Aggregate statistics over all resolved trades."""
        with self._lock:
            resolved = [r for r in self._records.values()
                        if r.get("result") in ("WIN", "LOSS")]
            total  = len(resolved)
            wins   = sum(1 for r in resolved if r["result"] == "WIN")
            losses = total - wins
            wr     = wins / total if total else 0.0
            pnl    = (wins - losses) * 100   # $100 flat stake

            s4 = [r for r in resolved if "S4" in r["strategy"]]
            s5 = [r for r in resolved if "S5" in r["strategy"]]

            # Session breakdown
            sessions = {}
            for r in resolved:
                s = r.get("session", "?")
                sessions.setdefault(s, {"total": 0, "wins": 0})
                sessions[s]["total"] += 1
                if r["result"] == "WIN":
                    sessions[s]["wins"] += 1
            for s in sessions:
                t = sessions[s]["total"]
                sessions[s]["wr"] = round(sessions[s]["wins"] / t * 100, 1) if t else 0.0

            # 7-day and 30-day WR
            from datetime import datetime, timezone, timedelta
            now = datetime.now(timezone.utc)
            def _wr_window(days):
                cutoff = (now - timedelta(days=days)).isoformat()
                w = [r for r in resolved if r["signal_time"] >= cutoff]
                ww = sum(1 for r in w if r["result"] == "WIN")
                return round(ww / len(w) * 100, 1) if w else None

            return {
                "total":    total,
                "wins":     wins,
                "losses":   losses,
                "win_rate": round(wr * 100, 1),
                "pnl_100":  pnl,
                "s4_total": len(s4),
                "s4_wins":  sum(1 for r in s4 if r["result"] == "WIN"),
                "s4_wr":    round(sum(1 for r in s4 if r["result"] == "WIN") / len(s4) * 100, 1) if s4 else 0.0,
                "s5_total": len(s5),
                "s5_wins":  sum(1 for r in s5 if r["result"] == "WIN"),
                "s5_wr":    round(sum(1 for r in s5 if r["result"] == "WIN") / len(s5) * 100, 1) if s5 else 0.0,
                "sessions": sessions,
                "wr_7d":    _wr_window(7),
                "wr_30d":   _wr_window(30),
            }
