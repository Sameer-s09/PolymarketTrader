"""
Mock trade journal — records Polymarket-odds-aware virtual trades.
Written to data/mock_trades.jsonl, entirely separate from fade_journal.jsonl.
Filters applied upstream: NO London, NO Saturday, NO martingale.
"""
from __future__ import annotations
import json
import os
import threading
from dataclasses import dataclass, asdict
from typing import Optional

MOCK_JOURNAL_FILE = os.path.join(os.path.dirname(__file__), "data", "mock_trades.jsonl")


@dataclass
class MockTrade:
    # Signal identity
    signal_id:          str
    strategy:           str           # "S4-Fade" | "S5-Fade"
    signal_time:        str           # ISO UTC — close of last streak candle
    entry_candle_open:  str           # ISO UTC — open of prediction candle
    entry_candle_close: str           # ISO UTC — close of prediction candle
    direction:          str           # "UP" | "DOWN"
    streak_colour:      str           # "green" | "red"
    streak_length:      int           # 4 or 5
    session:            str
    day_of_week:        str
    day_key:            str           # YYYY-MM-DD UTC — used for session-stop grouping
    entry_price:        float

    # Polymarket odds captured at signal time
    poly_odds:          float         # probability for our side, 0–1
    poly_payout:        float         # decimal multiplier, e.g. 1.92 → win profit = stake*(payout-1)
    poly_market_slug:   str
    poly_captured_at:   str

    stake: float = 10.0               # fixed $10 stake

    # Filled at candle close
    exit_price:    Optional[float] = None
    result:        Optional[str]   = None   # "WIN" | "LOSS" | "DOJI"
    directed_pct:  Optional[float] = None   # signed % move in trade direction
    profit:        Optional[float] = None   # actual $$ P&L
    resolved_at:   Optional[str]   = None


class MockJournal:
    def __init__(self, path: str = MOCK_JOURNAL_FILE):
        self._path    = path
        self._lock    = threading.RLock()
        self._records: dict[str, dict] = {}
        self._load()

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self) -> None:
        if not os.path.exists(self._path):
            return
        with open(self._path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
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

    def add(self, trade: MockTrade) -> bool:
        """Add a new mock trade. Returns False if signal_id already exists."""
        with self._lock:
            if trade.signal_id in self._records:
                return False
            self._records[trade.signal_id] = asdict(trade)
            self._save_all()
            return True

    def update(self, trade: MockTrade) -> None:
        """Overwrite with resolved outcome."""
        with self._lock:
            self._records[trade.signal_id] = asdict(trade)
            self._save_all()

    def session_consecutive_losses(self, day_key: str, session: str) -> int:
        """
        Return the number of consecutive resolved LOSSes at the END of the
        (day_key, session) block — i.e. how many back-to-back losses have
        occurred so far in this session today.
        Pending (unresolved) trades are ignored so a mid-session check
        doesn't block future trades that are still open.
        """
        with self._lock:
            block = [
                r for r in self._records.values()
                if r.get("day_key") == day_key and r.get("session") == session
                and r.get("result") in ("WIN", "LOSS")
            ]
            if not block:
                return 0
            block.sort(key=lambda r: r["signal_time"])
            consec = 0
            for r in reversed(block):
                if r["result"] == "LOSS":
                    consec += 1
                else:
                    break
            return consec

    def get_pending(self) -> list[MockTrade]:
        """Trades with entry_price but no result yet."""
        with self._lock:
            return [
                MockTrade(**r) for r in self._records.values()
                if r.get("result") is None and r.get("entry_price") is not None
            ]

    def get_all(self, limit: Optional[int] = None) -> list[dict]:
        """All records, newest first."""
        with self._lock:
            recs = sorted(
                self._records.values(),
                key=lambda r: r["signal_time"],
                reverse=True,
            )
            return recs[:limit] if limit else recs

    def stats(self) -> dict:
        """Aggregate stats over resolved mock trades."""
        with self._lock:
            resolved = [
                r for r in self._records.values()
                if r.get("result") in ("WIN", "LOSS")
            ]
            total  = len(resolved)
            wins   = sum(1 for r in resolved if r["result"] == "WIN")
            losses = total - wins
            wr     = wins / total if total else 0.0

            # Real P&L from actual Polymarket payouts
            actual_pnl = sum(r.get("profit") or 0.0 for r in resolved)

            # Avg odds
            avg_odds_win  = (
                sum(r["poly_odds"] for r in resolved if r["result"] == "WIN") / wins
                if wins else None
            )
            avg_odds_loss = (
                sum(r["poly_odds"] for r in resolved if r["result"] == "LOSS") / losses
                if losses else None
            )

            # Strategy breakdown
            s4 = [r for r in resolved if "S4" in r["strategy"]]
            s5 = [r for r in resolved if "S5" in r["strategy"]]

            def _strat_stats(lst: list[dict]) -> dict:
                t  = len(lst)
                w  = sum(1 for r in lst if r["result"] == "WIN")
                pl = sum(r.get("profit") or 0.0 for r in lst)
                return {"total": t, "wins": w, "wr": round(w/t*100, 1) if t else 0.0, "pnl": round(pl, 2)}

            # Session breakdown
            sessions: dict[str, dict] = {}
            for r in resolved:
                s = r.get("session", "?")
                sessions.setdefault(s, {"total": 0, "wins": 0, "pnl": 0.0})
                sessions[s]["total"] += 1
                if r["result"] == "WIN":
                    sessions[s]["wins"] += 1
                sessions[s]["pnl"] += r.get("profit") or 0.0
            for s in sessions:
                t = sessions[s]["total"]
                sessions[s]["wr"]  = round(sessions[s]["wins"] / t * 100, 1) if t else 0.0
                sessions[s]["pnl"] = round(sessions[s]["pnl"], 2)

            return {
                "total":         total,
                "wins":          wins,
                "losses":        losses,
                "win_rate":      round(wr * 100, 1),
                "actual_pnl":    round(actual_pnl, 2),
                "avg_odds_win":  round(avg_odds_win,  3) if avg_odds_win  is not None else None,
                "avg_odds_loss": round(avg_odds_loss, 3) if avg_odds_loss is not None else None,
                "s4": _strat_stats(s4),
                "s5": _strat_stats(s5),
                "sessions": sessions,
            }
