# BTC/USD Fade Strategy — Backtest Spec & Daily Automation Guide

## Overview

Two mean-reversion strategies on BTC/USD 15-minute candles.  
After N consecutive same-colour candles, the **next candle reverses** more than 57% of the time.  
Backtested: 5 years · Binance BTCUSDT · 3-min candles aggregated to 15-min · May 2021 → May 2026.

---

## Strategy Definitions

### S4-Fade
- **Signal:** 4 consecutive 15-min candles all close in the same direction (all green OR all red)
- **Bet:** next 15-min candle closes in the **opposite** direction
- **Entry:** open of the 5th candle
- **Exit:** close of the 5th candle
- **Direction:** if streak was UP → bet DOWN; if streak was DOWN → bet UP

### S5-Fade
- **Signal:** 5 consecutive 15-min candles all close in the same direction
- **Bet:** next 15-min candle closes in the **opposite** direction
- **Entry:** open of the 6th candle
- **Exit:** close of the 6th candle
- **Direction:** same flip logic as S4-Fade

### Candle Colour Rules
- **Green:** close > open
- **Red:** close < open
- **Doji (close == open):** breaks the streak — do not count, reset counter to 0

### 15-min Candle Construction (from 3-min source)
- open  = first 3-min candle open in the window
- high  = max high of all 5 candles
- low   = min low of all 5 candles
- close = last 3-min candle close in the window
- Windows align to UTC clock: :00, :15, :30, :45

### Win Definition
- Binary outcome: win if candle closes in predicted direction
- Win = `(close - open) * trade_direction > 0`
- Tie (doji prediction candle) = loss

---

## Backtest Results — 5-Year Summary

| Metric | S4-Fade | S5-Fade |
|---|---|---|
| Period | May 2021 – May 2026 | May 2021 – May 2026 |
| Total Trades | 16,683 | 7,153 |
| **Win Rate** | **57.1%** | **57.6%** |
| Trades / Day | 9.1 | 3.9 |
| Avg Win | +0.079% | +0.082% |
| Avg Loss | -0.075% | -0.077% |
| Profit Factor | 1.33 | 1.37 |
| **Sharpe Ratio** | **7.46** | **5.56** |
| Max Drawdown | $-2,000 | $-1,800 |
| Net P&L ($100/trade) | +$236,100 | +$108,500 |

All figures assume $100 flat stake per trade, binary outcome (+$100 win / -$100 loss).  
Statistics are Bonferroni-corrected binomial tests vs p = 0.50.

---

## Edge by Session (UTC)

Sessions defined in UTC. All slices below are statistically significant (p < 0.05 after Bonferroni correction).

| Session | Hours (UTC) | S4-Fade WR | S4 Trades | S5-Fade WR | S5 Trades |
|---|---|---|---|---|---|
| LONDON | 08:00 – 13:00 | **58.8%** | 3,271 | **60.1%** | 1,360 |
| LATE_NY | 21:00 – 00:00 | **59.4%** | 2,133 | **58.3%** | 881 |
| ASIA | 00:00 – 08:00 | **57.0%** | 5,487 | **58.5%** | 2,350 |
| NY | 16:00 – 21:00 | 55.5% | 3,719 | 54.9% | 1,658 |
| OVERLAP | 13:00 – 16:00 | 55.1% | 2,073 | 55.6% | 904 |

---

## Edge by Hour of Day (UTC)

Top performing hours. All are significant after Bonferroni correction.

### S4-Fade — Best Hours
| Hour (UTC) | Win Rate | Trades |
|---|---|---|
| 12:00 | **60.9%** | 617 |
| 23:00 | **60.4%** | 710 |
| 21:00 | **59.6%** | 721 |
| 08:00 | 59.0% | 669 |
| 06:00 | 58.8% | 691 |
| 01:00 | 58.8% | 650 |
| 10:00 | 58.9% | 621 |
| 00:00 | 58.6% | 667 |
| 09:00 | 58.1% | 694 |
| 22:00 | 58.3% | 702 |

### S5-Fade — Best Hours
| Hour (UTC) | Win Rate | Trades |
|---|---|---|
| 11:00 | **62.6%** | 281 |
| 12:00 | **62.1%** | 248 |
| 01:00 | **61.9%** | 270 |
| 23:00 | 60.3% | 287 |
| 10:00 | 60.6% | 246 |
| 05:00 | 59.7% | 295 |
| 06:00 | 59.2% | 314 |
| 21:00 | 59.1% | 313 |

---

## Edge by Day of Week

All days are significant for S4-Fade. Weekend is strongest for both.

| Day | S4-Fade WR | S4 Trades | S5-Fade WR | S5 Trades |
|---|---|---|---|---|
| **Saturday** | **61.2%** | 2,046 | **63.1%** | 785 |
| **Sunday** | **57.8%** | 2,292 | **59.1%** | 966 |
| Tuesday | 57.1% | 2,521 | 56.1% | 1,090 |
| Wednesday | 56.8% | 2,445 | 58.6% | 1,054 |
| Thursday | 56.2% | 2,347 | 56.2% | 1,029 |
| Friday | 55.6% | 2,475 | 56.8% | 1,099 |
| Monday | 55.5% | 2,557 | 55.0% | 1,130 |

---

## Edge by Month

### S4-Fade — Best Months
| Month | Win Rate | Trades |
|---|---|---|
| **April** | **58.6%** | 1,371 |
| **March** | **58.3%** | 1,439 |
| **September** | **58.3%** | 1,340 |
| October | 57.5% | 1,417 |
| May | 57.7% | 1,443 |
| January | 57.3% | 1,334 |

### S5-Fade — Best Months
| Month | Win Rate | Trades |
|---|---|---|
| **September** | **60.5%** | 557 |
| **April** | **59.9%** | 566 |
| **January** | **59.8%** | 569 |
| June | 58.4% | 567 |
| May | 58.2% | 610 |
| November | 58.1% | 602 |

---

## Year-by-Year Consistency

The edge is persistent across all 5 years — not a single year is below 55%.

| Year | S4-Fade WR | S4 Trades | S5-Fade WR | S5 Trades |
|---|---|---|---|---|
| 2021 | 57.1% | 2,049 | 57.8% | 879 |
| 2022 | 56.9% | 3,382 | 57.1% | 1,456 |
| **2023** | **59.0%** | 3,044 | **58.6%** | 1,246 |
| 2024 | 57.2% | 3,386 | 57.3% | 1,448 |
| 2025 | 55.7% | 3,565 | 57.1% | 1,579 |
| 2026 (partial) | 56.6% | 1,257 | 58.5% | 545 |

---

## High-Confidence Filter Combinations

Stack these filters to find the highest-edge setups. Listed by expected win rate.

| Priority | Filters | Expected WR | Approx Frequency |
|---|---|---|---|
| 1 | S5-Fade + Saturday | ~63% | ~2–3 trades/week |
| 2 | S5-Fade + Hour 11 or 12 UTC | ~62% | ~1–2 trades/day |
| 3 | S4-Fade + Saturday | ~61% | ~4–5 trades/week |
| 4 | S5-Fade + LONDON session | ~60% | ~1–2 trades/day |
| 5 | S4-Fade + Hour 12 UTC | ~61% | ~1 trade/day |
| 6 | S4-Fade + LATE_NY session | ~59% | ~1–2 trades/day |
| 7 | S4-Fade + LONDON session | ~59% | ~2–3 trades/day |
| 8 | S4-Fade + Sunday | ~58% | ~4–5 trades/week |

---

## Daily Automation Spec

### Data Requirements
- **Source:** Binance REST API
- **Endpoint:** `GET https://api.binance.com/api/v3/klines`
- **Params:** `symbol=BTCUSDT`, `interval=15m`, `limit=10`
- **No API key required** for public market data

### Signal Detection Logic (pseudocode)

```
every 15 minutes (at :00, :15, :30, :45 of each hour):

  fetch last 6 closed 15-min candles  [c1, c2, c3, c4, c5, c6]
  # c1 = oldest, c6 = most recently closed

  color(c) = "green" if c.close > c.open
           = "red"   if c.close < c.open
           = "doji"  if c.close == c.open

  # Check S5-Fade signal (higher priority, stronger edge)
  streak5 = all(color(c) == color(c5) for c in [c1, c2, c3, c4, c5])
         AND color(c5) != "doji"

  if streak5:
    direction = OPPOSITE of color(c5)
    fire_signal(strategy="S5-Fade", direction=direction, candle=c6)
    return  # don't double-count as S4

  # Check S4-Fade signal
  streak4 = all(color(c) == color(c5) for c in [c2, c3, c4, c5])
         AND color(c5) != "doji"

  if streak4:
    direction = OPPOSITE of color(c5)
    fire_signal(strategy="S4-Fade", direction=direction, candle=c6)
```

### Signal Object Schema
```json
{
  "strategy":       "S4-Fade" | "S5-Fade",
  "signal_time":    "2026-05-14T08:00:00Z",   // UTC close of last streak candle
  "entry_candle_open_time": "2026-05-14T08:15:00Z",
  "entry_candle_close_time": "2026-05-14T08:30:00Z",
  "direction":      "UP" | "DOWN",
  "streak_colour":  "green" | "red",
  "streak_length":  4 | 5,
  "hour_utc":       8,
  "session":        "LONDON",
  "day_of_week":    "Wednesday",
  "expected_wr":    0.588,
  "filters_active": ["LONDON", "weekday"]
}
```

### Outcome Tracking Schema
```json
{
  "signal_id":      "S4-2026-05-14T08:00:00Z",
  "entry_price":    81200.00,
  "exit_price":     81350.00,
  "direction":      "UP",
  "result":         "WIN" | "LOSS" | "DOJI",
  "pct_move":       0.00185,
  "directed_pct":   0.00185,
  "resolved_at":    "2026-05-14T08:30:00Z"
}
```

### Session Helper
```
ASIA    = 00:00 – 07:59 UTC
LONDON  = 08:00 – 12:59 UTC
OVERLAP = 13:00 – 15:59 UTC
NY      = 16:00 – 20:59 UTC
LATE_NY = 21:00 – 23:59 UTC
```

### Recommended Alert Thresholds
Only notify if expected win rate (based on active filters) exceeds:
- **Standard alert:** filters suggest WR > 57%
- **High-confidence alert:** filters suggest WR > 59% (e.g. Saturday, or hour 11–12, or LONDON + S5)
- **Skip:** NY session alone on a weekday (WR ~55%, borderline)

### Suggested Daily Report Format
```
Date: 2026-05-14 (Wednesday)
Signals fired today: 12 (S4: 9, S5: 3)
Results:  WIN 7 / LOSS 5  →  58.3% (expected ~56.8%)
P&L ($100/trade): +$200
Running 7-day WR: 57.1%  |  30-day WR: 56.9%

Best performing window: LONDON 08:00–09:00 UTC (3W/1L)
Worst window: NY 17:00–18:00 UTC (1W/2L)
```

---

## Statistical Notes

- All slices tested with two-sided binomial test vs null hypothesis p = 0.50
- p-values Bonferroni-corrected for number of buckets tested per dimension
- Minimum 30 trades required for any slice to be reported
- Edge is consistent across all 5 years — no sign of decay
- Sharpe ratio of 7.46 (S4-Fade) is unusually high due to binary outcome and stable edge
- Max drawdown is low ($2,000 on $100/trade sizing) because win rate is consistently above 50%

---

## Files in This Project

| File | Purpose |
|---|---|
| `data_fetcher.py` | Binance API fetch + parquet cache |
| `strategies.py` | All 5 original strategies (S1–S5) |
| `fade_backtest.py` | S4-Fade & S5-Fade full backtest + report |
| `edge_finder.py` | Statistical edge finder across all strategies |
| `main.py` | Full 5-strategy backtest runner |
| `data/btcusdt_3min.parquet` | 5-year cached candle data |
