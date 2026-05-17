"""
Performance metrics and multi-dimensional breakdowns for trade DataFrames.
"""
import numpy as np
import pandas as pd
from datetime import timezone

# BTC halving timestamps (UTC)
HALVINGS = [
    ("Halving 3", 1589155200),  # 2020-05-11
    ("Halving 4", 1713484800),  # 2024-04-19
]

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SESSIONS = ["ASIA", "LONDON", "OVERLAP", "NY", "LATE_NY"]


# ─────────────────────────── core metrics ────────────────────────────────────

def compute_metrics(trades: pd.DataFrame, name: str = "") -> dict:
    if trades.empty:
        return {"name": name, "trades": 0}

    wins = trades["win"].sum()
    total = len(trades)
    win_rate = wins / total

    winning = trades[trades["win"]]["directed_pct"]
    losing = trades[~trades["win"]]["directed_pct"]

    avg_win = winning.mean() if len(winning) else 0.0
    avg_loss = losing.mean() if len(losing) else 0.0
    profit_factor = (winning.sum() / abs(losing.sum())) if losing.sum() != 0 else np.inf

    # Equity curve: $100 per trade, win=+$100, loss=-$100
    equity = (trades["result"] * 100).cumsum()
    peak = equity.cummax()
    drawdown = equity - peak
    max_dd = drawdown.min()

    # Daily P&L for Sharpe
    trades = trades.copy()
    trades["date"] = trades["dt"].dt.normalize()
    daily = trades.groupby("date")["result"].sum() * 100
    sharpe = (daily.mean() / daily.std() * np.sqrt(252)) if daily.std() > 0 else 0.0

    # Trades per day
    days_span = (trades["dt"].max() - trades["dt"].min()).days or 1
    trades_per_day = total / days_span

    return {
        "name": name,
        "trades": total,
        "win_rate": win_rate,
        "avg_win_pct": avg_win * 100,
        "avg_loss_pct": avg_loss * 100,
        "profit_factor": profit_factor,
        "sharpe": sharpe,
        "max_dd_usd": max_dd,
        "trades_per_day": trades_per_day,
        "equity_final": equity.iloc[-1] if len(equity) else 0,
    }


def equity_series(trades: pd.DataFrame) -> pd.Series:
    """Cumulative equity ($100/trade binary)."""
    if trades.empty:
        return pd.Series(dtype=float)
    eq = (trades["result"] * 100).cumsum()
    eq.index = trades["dt"].values
    return eq


# ─────────────────────────── breakdowns ──────────────────────────────────────

def _win_rate_table(trades: pd.DataFrame, col: str, labels: list | None = None) -> pd.DataFrame:
    g = trades.groupby(col).agg(trades_n=("win", "count"), wins=("win", "sum")).reset_index()
    g["win_rate"] = g["wins"] / g["trades_n"]
    if labels:
        g[col] = g[col].map(lambda x: labels[x] if x < len(labels) else str(x))
    return g


def session_breakdown(trades: pd.DataFrame) -> pd.DataFrame:
    return _win_rate_table(trades, "session")


def hourly_breakdown(trades: pd.DataFrame) -> pd.DataFrame:
    return _win_rate_table(trades, "hour")


def dow_breakdown(trades: pd.DataFrame) -> pd.DataFrame:
    return _win_rate_table(trades, "day_of_week", DAYS)


def monthly_breakdown(trades: pd.DataFrame) -> pd.DataFrame:
    """Win rate by (year, month) for heatmap."""
    g = (
        trades.groupby(["year", "month"])
        .agg(trades_n=("win", "count"), wins=("win", "sum"))
        .reset_index()
    )
    g["win_rate"] = g["wins"] / g["trades_n"]
    return g


# ─────────────────────────── regime tagging ──────────────────────────────────

def tag_regimes(trades: pd.DataFrame, df15: pd.DataFrame) -> pd.DataFrame:
    """Attach volatility/trend regime columns to a trades DataFrame.

    df15 must be the full 15-min candle DataFrame (used to compute rolling metrics).
    """
    if trades.empty:
        return trades

    df = df15.copy().sort_values("timestamp")

    # ── realized 30-day volatility (log returns, annualised) ──
    df["log_ret"] = np.log(df["close"] / df["close"].shift(1))
    # 30 days = 30*24*4 = 2880 15-min candles
    df["vol30d"] = df["log_ret"].rolling(2880, min_periods=100).std() * np.sqrt(2880)
    q33 = df["vol30d"].quantile(0.33)
    q66 = df["vol30d"].quantile(0.66)
    df["vol_regime"] = pd.cut(
        df["vol30d"], bins=[-np.inf, q33, q66, np.inf], labels=["Low Vol", "Med Vol", "High Vol"]
    )

    # ── trend regime: price vs 200-period 15-min SMA ──
    df["sma200"] = df["close"].rolling(200, min_periods=50).mean()
    df["trend_regime"] = np.where(df["close"] > df["sma200"], "Uptrend", "Downtrend")

    # ── halving phase ──
    halving_ts = sorted([ts for _, ts in HALVINGS])

    def _phase(ts):
        for i, hts in enumerate(halving_ts):
            six_months = 6 * 30 * 24 * 3600
            if abs(ts - hts) < six_months:
                return "Near Halving"
        if ts > halving_ts[-1]:
            return "Post Halving"
        return "Pre Halving"

    df["halving_phase"] = df["timestamp"].map(_phase)

    regime_cols = df[["timestamp", "vol_regime", "trend_regime", "halving_phase"]].copy()

    # Match each trade to nearest 15-min candle
    trades = trades.copy()
    trades["_ts15"] = (trades["timestamp"] // 900) * 900
    regime_cols["_ts15"] = regime_cols["timestamp"]
    trades = trades.merge(regime_cols[["_ts15", "vol_regime", "trend_regime", "halving_phase"]],
                          on="_ts15", how="left")
    trades = trades.drop(columns=["_ts15"])
    return trades


def vol_regime_breakdown(trades: pd.DataFrame) -> pd.DataFrame:
    if "vol_regime" not in trades.columns:
        return pd.DataFrame()
    return _win_rate_table(trades, "vol_regime")


def trend_regime_breakdown(trades: pd.DataFrame) -> pd.DataFrame:
    if "trend_regime" not in trades.columns:
        return pd.DataFrame()
    return _win_rate_table(trades, "trend_regime")


def halving_breakdown(trades: pd.DataFrame) -> pd.DataFrame:
    if "halving_phase" not in trades.columns:
        return pd.DataFrame()
    return _win_rate_table(trades, "halving_phase")
