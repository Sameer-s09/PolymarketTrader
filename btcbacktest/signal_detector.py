"""
BTC Fade Signal Detector — live S4/S5 signal detection + mock trade resolution.
Polls Binance 15m candles. No API key required.
"""
from __future__ import annotations
import logging
import requests
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)

BINANCE_URL = "https://api.binance.com/api/v3/klines"
SYMBOL = "BTCUSDT"

_SESSIONS = [
    ("ASIA",    0,  8),
    ("LONDON",  8,  13),
    ("OVERLAP", 13, 16),
    ("NY",      16, 21),
    ("LATE_NY", 21, 24),
]
_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Per-session base expected WR from 5-year backtest
_SESSION_WR = {
    ("S4", "LONDON"):  0.588,
    ("S4", "LATE_NY"): 0.594,
    ("S4", "ASIA"):    0.570,
    ("S4", "NY"):      0.555,
    ("S4", "OVERLAP"): 0.551,
    ("S5", "LONDON"):  0.601,
    ("S5", "LATE_NY"): 0.583,
    ("S5", "ASIA"):    0.585,
    ("S5", "NY"):      0.549,
    ("S5", "OVERLAP"): 0.556,
}
_SAT_WR  = {"S4": 0.612, "S5": 0.631}
_HOUR_WR = {  # hours with notably elevated WR
    "S4": {12: 0.609, 23: 0.604, 21: 0.596, 8: 0.590, 10: 0.589},
    "S5": {11: 0.626, 12: 0.621, 1:  0.619, 23: 0.603, 10: 0.606},
}


def _session(hour: int) -> str:
    for name, lo, hi in _SESSIONS:
        if lo <= hour < hi:
            return name
    return "LATE_NY"


def _day_name(dt: datetime) -> str:
    return _DAYS[dt.weekday()]


def _expected_wr(strat_short: str, session: str, day: str, hour: int) -> float:
    """Estimate expected WR combining session, day-of-week and hour filters."""
    base = _SESSION_WR.get((strat_short, session), 0.571 if strat_short == "S4" else 0.576)
    if day == "Saturday":
        base = max(base, _SAT_WR[strat_short])
    hour_bump = _HOUR_WR.get(strat_short, {}).get(hour)
    if hour_bump:
        base = max(base, hour_bump)
    return round(base, 3)


# ── Candle helpers ────────────────────────────────────────────────────────────

def _colour(o: float, c: float) -> str:
    if c > o:  return "green"
    if c < o:  return "red"
    return "doji"


def fetch_15m_candles(limit: int = 8) -> list[dict]:
    """Return last `limit` fully-closed 15m BTCUSDT candles (oldest first)."""
    params = {"symbol": SYMBOL, "interval": "15m", "limit": limit + 2}
    r = requests.get(BINANCE_URL, params=params, timeout=15,
                     headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    candles = []
    for row in r.json():
        close_time_ms = int(row[6])
        if close_time_ms >= now_ms:   # not yet closed
            continue
        open_time_ms = int(row[0])
        candles.append({
            "open_time_ms":  open_time_ms,
            "close_time_ms": close_time_ms,
            "open":  float(row[1]),
            "high":  float(row[2]),
            "low":   float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
            "dt": datetime.fromtimestamp(open_time_ms / 1000, tz=timezone.utc),
        })
    return candles[-limit:]  # guaranteed closed, newest at end


def current_streak(candles: list[dict]) -> dict:
    """Return info about the current streak from the most recent closed candles."""
    if not candles:
        return {"length": 0, "colour": "none"}
    col = _colour(candles[-1]["open"], candles[-1]["close"])
    if col == "doji":
        return {"length": 0, "colour": "doji"}
    length = 1
    for c in reversed(candles[:-1]):
        if _colour(c["open"], c["close"]) == col:
            length += 1
        else:
            break
    return {"length": length, "colour": col}


# ── Signal dataclass ──────────────────────────────────────────────────────────

@dataclass
class Signal:
    signal_id: str
    strategy: str               # "S4-Fade" | "S5-Fade"
    signal_time: str            # ISO UTC — close time of last streak candle
    entry_candle_open: str      # ISO UTC — open of prediction candle
    entry_candle_close: str     # ISO UTC — close of prediction candle
    direction: str              # "UP" | "DOWN"
    streak_colour: str          # "green" | "red"
    streak_length: int          # 4 or 5
    hour_utc: int
    session: str
    day_of_week: str
    expected_wr: float
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    result: Optional[str] = None        # "WIN" | "LOSS" | "DOJI"
    pct_move: Optional[float] = None    # raw % move of candle
    directed_pct: Optional[float] = None  # signed by trade direction
    resolved_at: Optional[str] = None


# ── Detection ─────────────────────────────────────────────────────────────────

def detect_signal(candles: list[dict]) -> Optional[Signal]:
    """
    Given closed 15m candles (oldest first), detect an S4 or S5 fade signal.
    Fires when the Nth streak candle (c5) closes — the prediction candle is
    still live. This allows Polymarket odds to be captured mid-prediction-candle
    (via the 75s delay) so they correspond to the correct market window.
    """
    if len(candles) < 6:
        return None

    # c5 = last closed candle (final streak candle); prediction candle not yet closed
    c5, c4, c3, c2, c1 = (candles[-1], candles[-2], candles[-3],
                            candles[-4], candles[-5])

    streak_col = _colour(c5["open"], c5["close"])
    if streak_col == "doji":
        return None

    # S5: c1..c5 all same colour
    if all(_colour(c["open"], c["close"]) == streak_col for c in [c1, c2, c3, c4, c5]):
        strat, strat_short, streak_len = "S5-Fade", "S5", 5
    # S4: c2..c5 all same colour
    elif all(_colour(c["open"], c["close"]) == streak_col for c in [c2, c3, c4, c5]):
        strat, strat_short, streak_len = "S4-Fade", "S4", 4
    else:
        return None

    direction = "DOWN" if streak_col == "green" else "UP"
    dt = c5["dt"]
    hour = dt.hour
    session = _session(hour)
    day = _day_name(dt)

    signal_time_str  = datetime.fromtimestamp(c5["close_time_ms"] / 1000, tz=timezone.utc).isoformat()
    # Prediction candle opens immediately after c5 closes, runs for 15 minutes
    entry_open_str   = datetime.fromtimestamp((c5["close_time_ms"] + 1) / 1000, tz=timezone.utc).isoformat()
    entry_close_str  = datetime.fromtimestamp((c5["close_time_ms"] + 900_000) / 1000, tz=timezone.utc).isoformat()
    signal_id        = f"{strat.replace('-','')}-{datetime.fromisoformat(signal_time_str).strftime('%Y%m%dT%H%M%SZ')}"

    return Signal(
        signal_id=signal_id,
        strategy=strat,
        signal_time=signal_time_str,
        entry_candle_open=entry_open_str,
        entry_candle_close=entry_close_str,
        direction=direction,
        streak_colour=streak_col,
        streak_length=streak_len,
        hour_utc=hour,
        session=session,
        day_of_week=day,
        expected_wr=_expected_wr(strat_short, session, day, hour),
        entry_price=c5["close"],   # = prediction candle open (shared boundary price)
    )


def compute_adx(candles: list[dict], period: int = 14) -> list[dict]:
    """Return ADX, +DI, -DI per candle using Wilder smoothing."""
    n = len(candles)
    if n < period + 2:
        return []

    tr_list, pdm_list, mdm_list = [], [], []
    for i in range(1, n):
        H, L = candles[i]["high"], candles[i]["low"]
        pH, pL, pC = candles[i-1]["high"], candles[i-1]["low"], candles[i-1]["close"]
        tr  = max(H - L, abs(H - pC), abs(L - pC))
        up, dn = H - pH, pL - L
        tr_list.append(tr)
        pdm_list.append(up if up > dn and up > 0 else 0.0)
        mdm_list.append(dn if dn > up and dn > 0 else 0.0)

    if len(tr_list) < period:
        return []

    sm_tr  = sum(tr_list[:period])
    sm_pdm = sum(pdm_list[:period])
    sm_mdm = sum(mdm_list[:period])

    def _step(sp, sm, st):
        pdi  = 100.0 * sp / st if st else 0.0
        mdi  = 100.0 * sm / st if st else 0.0
        denom = pdi + mdi
        return pdi, mdi, (100.0 * abs(pdi - mdi) / denom if denom else 0.0)

    dx_vals, pdi_vals, mdi_vals, c_idxs = [], [], [], []
    pdi, mdi, dx = _step(sm_pdm, sm_mdm, sm_tr)
    dx_vals.append(dx); pdi_vals.append(pdi); mdi_vals.append(mdi); c_idxs.append(period)

    for i in range(period, len(tr_list)):
        sm_tr  = sm_tr  - sm_tr  / period + tr_list[i]
        sm_pdm = sm_pdm - sm_pdm / period + pdm_list[i]
        sm_mdm = sm_mdm - sm_mdm / period + mdm_list[i]
        pdi, mdi, dx = _step(sm_pdm, sm_mdm, sm_tr)
        dx_vals.append(dx); pdi_vals.append(pdi); mdi_vals.append(mdi); c_idxs.append(i + 1)

    if len(dx_vals) < period:
        return []

    adx_val = sum(dx_vals[:period]) / period
    results = []
    ci = c_idxs[period - 1]
    results.append({
        "time": candles[ci]["open_time_ms"] // 1000,
        "adx": round(adx_val, 2),
        "plus_di": round(pdi_vals[period - 1], 2),
        "minus_di": round(mdi_vals[period - 1], 2),
    })

    for i in range(period, len(dx_vals)):
        adx_val = (adx_val * (period - 1) + dx_vals[i]) / period
        ci = c_idxs[i]
        results.append({
            "time": candles[ci]["open_time_ms"] // 1000,
            "adx": round(adx_val, 2),
            "plus_di": round(pdi_vals[i], 2),
            "minus_di": round(mdi_vals[i], 2),
        })

    return results


def resolve_signal(signal: Signal, candles: list[dict]) -> Optional[Signal]:
    """
    Attempt to fill exit_price and result for a pending signal.
    Matches by the entry candle's close timestamp.
    """
    target_close_ms = int(
        datetime.fromisoformat(signal.entry_candle_close).timestamp() * 1000
    )
    for c in candles:
        if abs(c["close_time_ms"] - target_close_ms) < 30_000:  # 30s tolerance
            entry  = signal.entry_price or c["open"]
            exit_p = c["close"]
            pct    = (exit_p - entry) / entry
            tdir   = 1 if signal.direction == "UP" else -1
            dpct   = pct * tdir

            signal.exit_price    = exit_p
            signal.pct_move      = round(pct * 100, 4)
            signal.directed_pct  = round(dpct * 100, 4)
            signal.result        = "WIN" if dpct > 0 else ("DOJI" if dpct == 0 else "LOSS")
            signal.resolved_at   = datetime.now(timezone.utc).isoformat()
            return signal
    return None
