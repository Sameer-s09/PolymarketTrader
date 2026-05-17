"""
Binance 3-min BTCUSDT OHLCV fetcher with local parquet cache.
Endpoint: GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=3m
Response: [[open_time_ms, open, high, low, close, volume, ...], ...]
Incremental updates: only fetches missing candles on subsequent runs.
"""
import os
import time
import requests
import pandas as pd
from datetime import datetime, timezone

CACHE_FILE = os.path.join(os.path.dirname(__file__), "data", "btcusdt_3min.parquet")
API_URL = "https://api.binance.com/api/v3/klines"
SYMBOL = "BTCUSDT"
INTERVAL = "3m"
STEP_MS = 3 * 60 * 1000  # 3 min in milliseconds


def _fetch_batch(start_ms: int, end_ms: int, limit: int = 1000) -> list:
    params = {
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "startTime": start_ms,
        "endTime": end_ms,
        "limit": limit,
    }
    for attempt in range(5):
        try:
            r = requests.get(API_URL, params=params, timeout=30,
                             headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            if attempt == 4:
                raise RuntimeError(f"Binance API failed after 5 attempts: {exc}") from exc
            time.sleep(2 ** attempt)
    return []


def _parse_klines(rows: list) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume", "dt"])
    df = pd.DataFrame(rows, columns=[
        "open_time_ms", "open", "high", "low", "close", "volume",
        "close_time_ms", "quote_volume", "trades",
        "taker_buy_base", "taker_buy_quote", "ignore",
    ])
    df["timestamp"] = (df["open_time_ms"].astype("int64") // 1000)
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = df[col].astype(float)
    df["dt"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    return df[["timestamp", "open", "high", "low", "close", "volume", "dt"]]


def _fetch_range(start_ts: int, end_ts: int, limit: int = 1000, delay: float = 0.2) -> pd.DataFrame:
    """Fetch [start_ts, end_ts] (Unix seconds) in batches of up to `limit` candles."""
    all_frames: list[pd.DataFrame] = []
    t_ms = start_ts * 1000
    end_ms = end_ts * 1000
    total = max(1, (end_ts - start_ts) // (3 * 60))
    fetched = 0

    while t_ms < end_ms:
        batch_end_ms = min(t_ms + limit * STEP_MS, end_ms)
        rows = _fetch_batch(t_ms, batch_end_ms, limit)
        if not rows:
            t_ms = batch_end_ms + STEP_MS
            continue

        frame = _parse_klines(rows)
        all_frames.append(frame)
        t_ms = int(rows[-1][0]) + STEP_MS  # next candle after last received
        fetched += len(rows)

        dt_str = datetime.fromtimestamp(t_ms // 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        print(f"\r  Fetching... {min(fetched/total*100, 100):.1f}%  ({dt_str})", end="", flush=True)
        time.sleep(delay)

    print()
    if not all_frames:
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume", "dt"])

    df = pd.concat(all_frames, ignore_index=True)
    return df.sort_values("timestamp").drop_duplicates("timestamp").reset_index(drop=True)


def load_data(years: float = 5) -> pd.DataFrame:
    """Return DataFrame of 3-min BTCUSDT candles covering the last `years` years.

    Uses a local parquet cache; fetches only missing candles on subsequent runs.
    """
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    now_ts = int(datetime.now(timezone.utc).timestamp())
    start_ts = int(now_ts - years * 365.25 * 24 * 3600)

    if os.path.exists(CACHE_FILE):
        print("Loading cached 3-min data (Binance BTCUSDT)...")
        df = pd.read_parquet(CACHE_FILE)
        cached_end = int(df["timestamp"].max())
        if now_ts - cached_end > 180:
            print(
                f"  Updating from "
                f"{datetime.fromtimestamp(cached_end, tz=timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC..."
            )
            new_df = _fetch_range(cached_end + 180, now_ts)
            if not new_df.empty:
                df = (
                    pd.concat([df, new_df])
                    .drop_duplicates("timestamp")
                    .sort_values("timestamp")
                    .reset_index(drop=True)
                )
                df.to_parquet(CACHE_FILE)
                print(f"  Cache updated: {len(df):,} total candles")
    else:
        print("No cache found. Fetching 5 years of 3-min BTC/USDT data from Binance (~876k candles)...")
        print("  This will take ~5-8 minutes. Subsequent runs will be instant.")
        df = _fetch_range(start_ts, now_ts)
        df.to_parquet(CACHE_FILE)
        print(f"  Saved {len(df):,} candles to {CACHE_FILE}")

    df = df[df["timestamp"] >= start_ts].copy()
    df["dt"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    df = df.reset_index(drop=True)

    print(
        f"  Loaded {len(df):,} candles | "
        f"{df['dt'].min().strftime('%Y-%m-%d')} to {df['dt'].max().strftime('%Y-%m-%d')} UTC"
    )
    return df
