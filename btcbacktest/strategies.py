"""
All 5 BTC binary-outcome strategies.

Common trade schema (returned DataFrame columns):
  dt, timestamp, window_start_ts, entry_price, exit_price,
  trade_direction (+1=UP, -1=DOWN), pct_move, directed_pct,
  win (bool), result (+1/-1),
  hour, day_of_week (0=Mon), month, year, session
"""
import numpy as np
import pandas as pd

SESSIONS = [("ASIA", 0, 8), ("LONDON", 8, 13), ("OVERLAP", 13, 16), ("NY", 16, 21), ("LATE_NY", 21, 24)]


def _session(hour: int) -> str:
    for name, lo, hi in SESSIONS:
        if lo <= hour < hi:
            return name
    return "LATE_NY"


def _add_time_cols(df: pd.DataFrame) -> pd.DataFrame:
    if "dt" not in df.columns:
        df["dt"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    df["hour"] = df["dt"].dt.hour
    df["day_of_week"] = df["dt"].dt.dayofweek
    df["month"] = df["dt"].dt.month
    df["year"] = df["dt"].dt.year
    df["session"] = df["hour"].map(_session)
    return df


def _finalise(signals: pd.DataFrame, c5_close: pd.DataFrame) -> pd.DataFrame:
    """Join window exit price, compute outcome columns, return clean trade DataFrame."""
    s = signals.merge(c5_close, on="window_start_ts", how="left").dropna(subset=["window_close"])
    s = s.copy()
    s["entry_price"] = s["close"]
    s["exit_price"] = s["window_close"]
    s["pct_move"] = (s["exit_price"] - s["entry_price"]) / s["entry_price"]
    s["directed_pct"] = s["pct_move"] * s["trade_direction"]
    s["win"] = s["directed_pct"] > 0
    s["result"] = np.where(s["win"], 1, -1)
    _add_time_cols(s)
    cols = [
        "dt", "timestamp", "window_start_ts", "candle_in_window",
        "entry_price", "exit_price", "trade_direction", "pct_move",
        "directed_pct", "win", "result", "hour", "day_of_week", "month", "year", "session",
    ]
    return s[cols].reset_index(drop=True)


def _build_15min(df3: pd.DataFrame) -> pd.DataFrame:
    """Aggregate 3-min candles into complete 15-min candles."""
    d = df3.copy()
    d["window_start_ts"] = (d["timestamp"] // 900) * 900
    agg = d.groupby("window_start_ts").agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        volume=("volume", "sum"),
        _n=("close", "count"),
    ).reset_index()
    agg = agg[agg["_n"] == 5].drop(columns="_n")
    agg["timestamp"] = agg["window_start_ts"]
    agg["dt"] = pd.to_datetime(agg["timestamp"], unit="s", utc=True)
    return agg.sort_values("timestamp").reset_index(drop=True)


# ─────────────────────────── core prep ───────────────────────────────────────

def _prep(df3: pd.DataFrame):
    """Add body_pct, direction, window columns to 3-min DataFrame."""
    df = df3.copy()
    df["body_pct"] = (df["close"] - df["open"]).abs() / df["open"]
    df["direction"] = np.sign(df["close"] - df["open"])
    df["window_start_ts"] = (df["timestamp"] // 900) * 900
    df["candle_in_window"] = (df["timestamp"] - df["window_start_ts"]) // 180

    # ── threshold: max body_pct of the 20 candles immediately before window start ──
    # At position i, shift(1).rolling(20).max() = max of candles [i-20 … i-1]
    # We capture this at C1 (candle_in_window == 0) and broadcast across the window.
    df["_rolling_max"] = df["body_pct"].shift(1).rolling(20).max()
    c1_thresh = (
        df[df["candle_in_window"] == 0][["window_start_ts", "_rolling_max"]]
        .rename(columns={"_rolling_max": "threshold"})
    )
    df = df.merge(c1_thresh, on="window_start_ts", how="left")

    # ── 1-hour trend: open 20 candles ago → current close ──
    df["_open_1h_ago"] = df["open"].shift(20)
    df["trend_1h"] = np.sign(df["close"] - df["_open_1h_ago"])

    # ── C5 close (window exit price) ──
    c5 = (
        df[df["candle_in_window"] == 4][["window_start_ts", "close"]]
        .rename(columns={"close": "window_close"})
    )

    return df.drop(columns=["_rolling_max", "_open_1h_ago"]), c5


# ─────────────────────────── Strategy 1 ──────────────────────────────────────

def strategy1(df3: pd.DataFrame) -> pd.DataFrame:
    """1H Size Breakout: any candle body% > prior-1H max → trade in candle direction."""
    df, c5 = _prep(df3)
    mask = (
        (df["body_pct"] > df["threshold"])
        & df["threshold"].notna()
        & (df["direction"] != 0)
        & (df["candle_in_window"] < 4)  # C5 entry = immediate exit, skip
    )
    sig = df[mask].copy()
    sig["trade_direction"] = sig["direction"]
    return _finalise(sig, c5)


# ─────────────────────────── Strategy 2 ──────────────────────────────────────

def strategy2(df3: pd.DataFrame) -> pd.DataFrame:
    """1H Trend + Size Breakout: size condition AND candle direction matches 1H trend."""
    df, c5 = _prep(df3)
    mask = (
        (df["body_pct"] > df["threshold"])
        & df["threshold"].notna()
        & (df["direction"] != 0)
        & (df["direction"] == df["trend_1h"])
        & (df["trend_1h"] != 0)
        & (df["candle_in_window"] < 4)
    )
    sig = df[mask].copy()
    sig["trade_direction"] = sig["direction"]
    return _finalise(sig, c5)


# ─────────────────────────── Strategy 3 ──────────────────────────────────────

def strategy3(df3: pd.DataFrame) -> pd.DataFrame:
    """15M Window Breakout: cumulative window move ≥ prior-1H max window move (fires once)."""
    df, c5 = _prep(df3)

    # C1 open (window reference price)
    c1_open = (
        df[df["candle_in_window"] == 0][["window_start_ts", "open"]]
        .rename(columns={"open": "c1_open"})
    )
    df = df.merge(c1_open, on="window_start_ts", how="left")

    df["window_move"] = (df["close"] - df["c1_open"]).abs() / df["c1_open"]
    df["window_dir"] = np.sign(df["close"] - df["c1_open"])

    # Threshold: max final (C5) window_move of the prior 4 complete 15-min windows
    c5_moves = (
        df[df["candle_in_window"] == 4][["window_start_ts", "window_move"]]
        .sort_values("window_start_ts")
        .reset_index(drop=True)
    )
    c5_moves["s3_threshold"] = c5_moves["window_move"].shift(1).rolling(4).max()
    df = df.drop(columns=["threshold"], errors="ignore")  # avoid column clash
    df = df.merge(c5_moves[["window_start_ts", "s3_threshold"]], on="window_start_ts", how="left")

    df["_raw"] = (
        (df["window_move"] >= df["s3_threshold"])
        & df["s3_threshold"].notna()
        & (df["window_dir"] != 0)
        & (df["candle_in_window"] < 4)
    )

    # Fire exactly once per window (first crossing)
    df = df.sort_values(["window_start_ts", "candle_in_window"])
    df["_cumraw"] = df.groupby("window_start_ts")["_raw"].cumsum()
    df["signal"] = df["_raw"] & (df["_cumraw"] == 1)

    # Re-add threshold col for _finalise compatibility
    df["threshold"] = df["s3_threshold"]
    sig = df[df["signal"]].copy()
    sig["trade_direction"] = sig["window_dir"]
    return _finalise(sig, c5)


# ─────────────────────────── Strategy 4 & 5 ──────────────────────────────────

def _consecutive(df15: pd.DataFrame, n: int) -> pd.DataFrame:
    """n consecutive same-color 15-min candles → bet on (n+1)th being same color."""
    df = df15.copy()
    df["color"] = np.sign(df["close"] - df["open"])

    # Shifted colors: shift(1) = 1 candle ago, shift(n) = n candles ago
    shifted = [df["color"].shift(i) for i in range(1, n + 1)]

    streak = shifted[0] != 0  # most recent not a doji
    for c in shifted[1:]:
        streak = streak & (c == shifted[0])  # all identical

    df["signal"] = streak
    df["bet_direction"] = shifted[0]  # direction of the streak

    sig = df[df["signal"] & (df["bet_direction"] != 0)].copy()

    # Entry = open of the predicted candle, exit = close of same candle
    sig["entry_price"] = sig["open"]
    sig["exit_price"] = sig["close"]
    sig["trade_direction"] = sig["bet_direction"]
    sig["pct_move"] = (sig["exit_price"] - sig["entry_price"]) / sig["entry_price"]
    sig["directed_pct"] = sig["pct_move"] * sig["trade_direction"]
    sig["win"] = sig["directed_pct"] > 0
    sig["result"] = np.where(sig["win"], 1, -1)
    sig["window_start_ts"] = sig["timestamp"]
    sig["candle_in_window"] = 0

    _add_time_cols(sig)
    cols = [
        "dt", "timestamp", "window_start_ts", "candle_in_window",
        "entry_price", "exit_price", "trade_direction", "pct_move",
        "directed_pct", "win", "result", "hour", "day_of_week", "month", "year", "session",
    ]
    return sig[cols].reset_index(drop=True)


def strategy4(df3: pd.DataFrame) -> pd.DataFrame:
    """4 consecutive same-color 15-min candles → bet on 5th being same color."""
    return _consecutive(_build_15min(df3), n=4)


def strategy5(df3: pd.DataFrame) -> pd.DataFrame:
    """5 consecutive same-color 15-min candles → bet on 6th being same color."""
    return _consecutive(_build_15min(df3), n=5)


# ─────────────────────────── runner ──────────────────────────────────────────

def run_all(df3: pd.DataFrame) -> dict[str, pd.DataFrame]:
    print("Running strategies...")
    results = {}
    for label, fn in [
        ("S1_Size_Breakout", strategy1),
        ("S2_Trend_Size", strategy2),
        ("S3_Window_Breakout", strategy3),
        ("S4_4_Consecutive", strategy4),
        ("S5_5_Consecutive", strategy5),
    ]:
        print(f"  {label}...", end=" ")
        trades = fn(df3)
        results[label] = trades
        print(f"{len(trades):,} trades")
    return results
