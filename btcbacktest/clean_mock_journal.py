"""
One-shot script: remove mock trades with suspect Polymarket odds (< 10% or > 90%).
These were captured at candle-close before the new market had real bids.
Run once on Oracle after deploying the timing fix.
"""
import json, os, shutil

JOURNAL = os.path.join(os.path.dirname(__file__), "data", "mock_trades.jsonl")
BACKUP  = JOURNAL + ".bak"

MIN_ODDS = 0.10
MAX_ODDS = 0.90

if not os.path.exists(JOURNAL):
    print("Journal not found:", JOURNAL)
    exit(1)

shutil.copy2(JOURNAL, BACKUP)
print(f"Backup written → {BACKUP}")

with open(JOURNAL, "r", encoding="utf-8") as f:
    lines = [l.strip() for l in f if l.strip()]

records = []
for l in lines:
    try:
        records.append(json.loads(l))
    except json.JSONDecodeError:
        pass

kept    = [r for r in records if MIN_ODDS <= r.get("poly_odds", 0.5) <= MAX_ODDS]
removed = [r for r in records if r not in kept]

print(f"\nTotal records : {len(records)}")
print(f"Kept (good)   : {len(kept)}")
print(f"Removed (bad) : {len(removed)}")
print()
for r in removed:
    print(f"  REMOVE  {r['signal_time'][:16]}  {r['session']:<8} odds={r['poly_odds']:.3f}  {r.get('result','?')}")

kept.sort(key=lambda r: r["signal_time"])
with open(JOURNAL, "w", encoding="utf-8") as f:
    for r in kept:
        f.write(json.dumps(r) + "\n")

print(f"\nJournal cleaned. {len(kept)} records remain.")
