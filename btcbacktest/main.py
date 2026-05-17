"""
BTC/USD Polymarket Strategy Backtest
=====================================
Run:  python main.py
      python main.py --years 3          # shorter lookback
      python main.py --out my_report.html
"""
import argparse
import sys
import os

# Allow sibling imports when run directly
sys.path.insert(0, os.path.dirname(__file__))

import data_fetcher
import strategies
import analysis as an
import report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=float, default=5.0, help="Lookback in years (default 5)")
    parser.add_argument("--out", type=str, default="btc_backtest_report.html", help="Output HTML path")
    args = parser.parse_args()

    # ── 1. Load data ──────────────────────────────────────────────────────────
    df3 = data_fetcher.load_data(years=args.years)

    # ── 2. Build 15-min candles (needed for regime tagging) ──────────────────
    from strategies import _build_15min
    df15 = _build_15min(df3)

    # ── 3. Run all strategies ─────────────────────────────────────────────────
    all_trades = strategies.run_all(df3)

    # ── 4. Compute metrics ────────────────────────────────────────────────────
    print("Computing metrics...")
    all_metrics = [
        an.compute_metrics(trades, name=report.STRATEGY_NAMES.get(key, key))
        for key, trades in all_trades.items()
    ]

    # Print quick summary to console
    print()
    print(f"{'Strategy':<30} {'Trades':>8} {'WinRate':>8} {'Sharpe':>7} {'MaxDD':>10}")
    print("-" * 68)
    for m in all_metrics:
        if m.get("trades", 0) == 0:
            continue
        print(
            f"{m['name']:<30} {m['trades']:>8,} {m['win_rate']*100:>7.1f}% "
            f"{m['sharpe']:>7.2f} ${m['max_dd_usd']:>9,.0f}"
        )
    print()

    # ── 5. Generate report ────────────────────────────────────────────────────
    out_path = os.path.join(os.path.dirname(__file__), args.out)
    report.generate(all_trades, all_metrics, df15, output_path=out_path)

    print(f"\nDone. Open the report in your browser:\n  {out_path}")


if __name__ == "__main__":
    main()
