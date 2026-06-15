"""
BTC Fade Live Signal Detector — Web App
Polls Binance every 60s, detects S4/S5 fade signals, journals mock trade outcomes.

Run:  python live_app.py
Open: http://localhost:5050
"""
import logging
import threading
import time
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, render_template_string

from signal_detector import fetch_15m_candles, detect_signal, resolve_signal, current_streak, Signal as _Signal
from journal_store import JournalStore
from polymarket_client import fetch_odds
from mock_journal import MockJournal, MockTrade
from telegram_notifier import alert_trade_placed, alert_trade_resolved

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app        = Flask(__name__)
jstore     = JournalStore()
mock_store = MockJournal()

# ── Filter constants for mock trading ────────────────────────────────────────
MOCK_SKIP_SESSIONS  = {"LONDON"}
MOCK_SKIP_DAYS      = {"Saturday"}
MOCK_ODDS_DELAY_S   = 75          # seconds to wait before capturing odds (let new market settle)
MOCK_ODDS_MIN       = 0.10        # reject odds below this — expiring market (losing side → ~0)
MOCK_ODDS_MAX       = 0.90        # reject odds above this — market-maker ask only (winning side → ~1)


def _signal_day_key(signal) -> str:
    """Extract YYYY-MM-DD UTC from a signal's signal_time."""
    return signal.signal_time[:10]


def _delayed_mock_capture(signal, day_key: str) -> None:
    """
    Called 75s after signal detection in a daemon thread.
    By then the previous 15m Polymarket market has fully settled and the
    new period's market has real buyer bids — odds are meaningful.
    Re-checks the 2-consecutive-loss session stop at capture time so that
    a loss resolved during the 75s window is counted before we commit.
    """
    try:
        # Guard: if the prediction candle has already closed, the poll loop ran
        # late and the odds we'd capture now belong to a different Polymarket
        # market — skip to avoid mismatched data.
        now = datetime.now(timezone.utc)
        entry_close = datetime.fromisoformat(
            signal.entry_candle_close.replace("Z", "+00:00")
        )
        if now >= entry_close:
            log.warning(
                f"MOCK SKIP {signal.signal_id} — detected late, prediction candle "
                f"already closed at {signal.entry_candle_close[:16]} UTC "
                f"(now {now.strftime('%H:%M')} UTC). Odds would mismatch."
            )
            return

        # Re-check session stop — a trade from this session may have resolved
        # during the 75s wait, pushing consecutive losses to 2.
        consec = mock_store.session_consecutive_losses(day_key, signal.session)
        if consec >= 2:
            log.info(
                f"MOCK SKIP {signal.signal_id} — 2-consec-loss stop still active "
                f"at capture time ({signal.session} {day_key}, {consec} losses)"
            )
            return

        poly = fetch_odds()
        if not poly:
            log.warning(f"MOCK SKIP {signal.signal_id} — Polymarket unavailable after {MOCK_ODDS_DELAY_S}s delay")
            return

        is_up  = signal.direction == "UP"
        odds   = poly["oddsUp"]   if is_up else poly["oddsDown"]
        payout = poly["payoutUp"] if is_up else poly["payoutDown"]

        # Sanity guard — reject stale/extreme odds even after delay
        if odds < MOCK_ODDS_MIN or odds > MOCK_ODDS_MAX:
            log.warning(
                f"MOCK SKIP {signal.signal_id} — odds {odds:.3f} outside "
                f"[{MOCK_ODDS_MIN},{MOCK_ODDS_MAX}] after delay (stale market)"
            )
            return

        mt = MockTrade(
            signal_id          = signal.signal_id,
            strategy           = signal.strategy,
            signal_time        = signal.signal_time,
            entry_candle_open  = signal.entry_candle_open,
            entry_candle_close = signal.entry_candle_close,
            direction          = signal.direction,
            streak_colour      = signal.streak_colour,
            streak_length      = signal.streak_length,
            session            = signal.session,
            day_of_week        = signal.day_of_week,
            day_key            = day_key,
            entry_price        = signal.entry_price,
            poly_odds          = odds,
            poly_payout        = payout,
            poly_market_slug   = poly.get("slug", ""),
            poly_captured_at   = poly.get("lastUpdated", ""),
        )
        if mock_store.add(mt):
            log.info(
                f"MOCK    {signal.strategy} {signal.direction} "
                f"odds={odds:.3f} payout={payout:.3f}x "
                f"slug={poly.get('slug', '?')} (captured +{MOCK_ODDS_DELAY_S}s)"
            )
            try:
                alert_trade_placed(
                    strategy         = mt.strategy,
                    direction        = mt.direction,
                    session          = mt.session,
                    day_of_week      = mt.day_of_week,
                    streak_colour    = mt.streak_colour,
                    streak_length    = mt.streak_length,
                    entry_price      = mt.entry_price,
                    poly_odds        = mt.poly_odds,
                    poly_payout      = mt.poly_payout,
                    poly_market_slug = mt.poly_market_slug,
                    signal_time      = mt.signal_time,
                    stake            = mt.stake,
                )
            except Exception as tg_exc:
                log.warning(f"Telegram alert (placed) failed: {tg_exc}")
    except Exception as exc:
        log.error(f"MOCK CAPTURE ERROR {signal.signal_id}: {exc}")

_status      = {}
_status_lock = threading.Lock()


# ── Background polling loop ───────────────────────────────────────────────────

def _next_15m_close() -> str:
    now  = datetime.now(timezone.utc)
    mins = now.minute
    slot = ((mins // 15) + 1) * 15
    if slot >= 60:
        nxt = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    else:
        nxt = now.replace(minute=slot, second=0, microsecond=0)
    return nxt.isoformat()


def _poll_loop() -> None:
    while True:
        try:
            candles = fetch_15m_candles(limit=8)
            now_iso = datetime.now(timezone.utc).isoformat()

            # Current streak
            streak = current_streak(candles)

            # Detect new signal
            last_signal_id = None
            signal = detect_signal(candles)
            if signal:
                added = jstore.add(signal)
                if added:
                    log.info(
                        f"SIGNAL  {signal.strategy} {signal.direction} @ "
                        f"{signal.entry_price:,.2f} | {signal.session} | "
                        f"EWR {signal.expected_wr:.1%}"
                    )
                    # ── Mock trade: skip London & Saturday ───────────────────
                    if signal.session not in MOCK_SKIP_SESSIONS and signal.day_of_week not in MOCK_SKIP_DAYS:
                        day_key = _signal_day_key(signal)
                        consec  = mock_store.session_consecutive_losses(day_key, signal.session)
                        if consec >= 2:
                            log.info(
                                f"MOCK SKIP {signal.strategy} {signal.session}/{day_key} "
                                f"— 2-consec-loss session stop ({consec} losses)"
                            )
                        else:
                            # Delay 75s so the new Polymarket market has real bids
                            t = threading.Timer(MOCK_ODDS_DELAY_S, _delayed_mock_capture, args=[signal, day_key])
                            t.daemon = True
                            t.start()
                            log.info(
                                f"MOCK    {signal.strategy} {signal.direction} "
                                f"— odds capture scheduled in {MOCK_ODDS_DELAY_S}s "
                                f"(session losses so far: {consec})"
                            )
                    else:
                        log.info(f"MOCK SKIP {signal.strategy} {signal.session}/{signal.day_of_week} (filtered)")
                last_signal_id = signal.signal_id

            # Resolve pending main-journal trades
            for pending in jstore.get_pending():
                resolved = resolve_signal(pending, candles)
                if resolved:
                    jstore.update(resolved)
                    log.info(
                        f"CLOSED  {resolved.signal_id} -> {resolved.result} "
                        f"({resolved.directed_pct:+.3f}%)"
                    )

            # Resolve pending mock trades
            for pm in mock_store.get_pending():
                proxy = _Signal(
                    signal_id          = pm.signal_id,
                    strategy           = pm.strategy,
                    signal_time        = pm.signal_time,
                    entry_candle_open  = pm.entry_candle_open,
                    entry_candle_close = pm.entry_candle_close,
                    direction          = pm.direction,
                    streak_colour      = pm.streak_colour,
                    streak_length      = pm.streak_length,
                    hour_utc           = 0,
                    session            = pm.session,
                    day_of_week        = pm.day_of_week,
                    expected_wr        = 0.0,
                    entry_price        = pm.entry_price,
                )
                resolved = resolve_signal(proxy, candles)
                if resolved:
                    pm.exit_price   = resolved.exit_price
                    pm.directed_pct = resolved.directed_pct
                    pm.result       = resolved.result
                    if resolved.result == "WIN":
                        pm.profit = round(pm.stake * (pm.poly_payout - 1.0), 2)
                    elif resolved.result == "LOSS":
                        pm.profit = -pm.stake
                    else:
                        pm.profit = 0.0
                    pm.resolved_at = resolved.resolved_at
                    mock_store.update(pm)
                    log.info(
                        f"MOCK CLOSED {pm.signal_id} -> {pm.result} "
                        f"profit=${pm.profit:+.2f}"
                    )
                    try:
                        alert_trade_resolved(
                            strategy     = pm.strategy,
                            direction    = pm.direction,
                            session      = pm.session,
                            day_of_week  = pm.day_of_week,
                            entry_price  = pm.entry_price,
                            exit_price   = pm.exit_price,
                            directed_pct = pm.directed_pct,
                            poly_odds    = pm.poly_odds,
                            poly_payout  = pm.poly_payout,
                            result       = pm.result,
                            profit       = pm.profit,
                            signal_time  = pm.signal_time,
                            resolved_at  = pm.resolved_at,
                        )
                    except Exception as tg_exc:
                        log.warning(f"Telegram alert (resolved) failed: {tg_exc}")

            with _status_lock:
                _status.update({
                    "last_check":       now_iso,
                    "next_candle_close": _next_15m_close(),
                    "streak":           streak,
                    "last_signal_id":   last_signal_id,
                    "pending_count":    len(jstore.get_pending()),
                })

        except Exception as exc:
            log.error(f"Poll error: {exc}")

        time.sleep(60)


# ── HTML Template ─────────────────────────────────────────────────────────────

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BTC Fade — Live Signals</title>
<style>
  :root {
    --bg:      #0d1117;
    --card:    #161b22;
    --border:  #30363d;
    --text:    #e6edf3;
    --muted:   #8b949e;
    --green:   #3fb950;
    --red:     #f85149;
    --amber:   #e3b341;
    --blue:    #58a6ff;
    --c4:      #00d4ff;
    --c5:      #ff6b35;
    --purple:  #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px; }

  /* ── Header ── */
  .header { background: var(--card); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 17px; font-weight: 600; color: var(--c4); letter-spacing: .5px; }
  .header h1 span { color: var(--c5); }
  .header-right { margin-left: auto; display: flex; align-items: center; gap: 20px; font-size: 12px; color: var(--muted); }
  .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)} }

  /* ── Tab bar ── */
  .tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--card); padding: 0 24px; }
  .tab  { padding: 12px 20px; cursor: pointer; font-size: 13px; color: var(--muted); border-bottom: 2px solid transparent; transition: all .15s; user-select: none; }
  .tab:hover  { color: var(--text); }
  .tab.active { color: var(--blue); border-bottom-color: var(--blue); }

  /* ── Panels ── */
  .panel { display: none; padding: 24px; }
  .panel.active { display: block; }

  /* ── Status cards ── */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card  { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; margin-bottom: 6px; }
  .card-value { font-size: 22px; font-weight: 700; }
  .card-sub   { font-size: 11px; color: var(--muted); margin-top: 4px; }

  /* ── Streak indicator ── */
  .streak-bar { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; display: flex; align-items: center; gap: 16px; }
  .streak-dots { display: flex; gap: 6px; }
  .dot { width: 18px; height: 18px; border-radius: 4px; }
  .dot.green { background: var(--green); }
  .dot.red   { background: var(--red); }
  .dot.empty { background: var(--border); }
  .streak-label { font-size: 13px; color: var(--muted); }
  .streak-signal { margin-left: auto; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .streak-signal.s4 { background: rgba(0,212,255,.15); color: var(--c4); border: 1px solid rgba(0,212,255,.3); }
  .streak-signal.s5 { background: rgba(255,107,53,.15); color: var(--c5); border: 1px solid rgba(255,107,53,.3); }
  .streak-signal.none { background: var(--border); color: var(--muted); border: 1px solid transparent; }

  /* ── Recent signals list ── */
  .section-title { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; margin-bottom: 12px; }
  .signal-row { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 14px 16px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; }
  .signal-row.win  { border-left: 3px solid var(--green); }
  .signal-row.loss { border-left: 3px solid var(--red); }
  .signal-row.pending { border-left: 3px solid var(--amber); }
  .strat-badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; }
  .strat-badge.s4 { background: rgba(0,212,255,.15); color: var(--c4); }
  .strat-badge.s5 { background: rgba(255,107,53,.15); color: var(--c5); }
  .dir-badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; }
  .dir-badge.up   { background: rgba(63,185,80,.15); color: var(--green); }
  .dir-badge.down { background: rgba(248,81,73,.15);  color: var(--red); }
  .result-badge { font-size: 12px; font-weight: 700; margin-left: auto; }
  .result-badge.win  { color: var(--green); }
  .result-badge.loss { color: var(--red); }
  .result-badge.doji { color: var(--amber); }
  .result-badge.pending { color: var(--amber); }
  .signal-meta { font-size: 11px; color: var(--muted); }
  .signal-price { font-size: 13px; font-weight: 600; }
  .directed-pct { font-size: 12px; }
  .directed-pct.pos { color: var(--green); }
  .directed-pct.neg { color: var(--red); }

  /* ── Journal panel ── */
  .journal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
  .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .filter-btn { padding: 5px 14px; border-radius: 20px; border: 1px solid var(--border); background: transparent; color: var(--muted); cursor: pointer; font-size: 12px; transition: all .15s; }
  .filter-btn:hover { border-color: var(--blue); color: var(--text); }
  .filter-btn.active { background: rgba(88,166,255,.15); border-color: var(--blue); color: var(--blue); }

  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 24px; }
  .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
  .stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .7px; margin-bottom: 4px; }
  .stat-value { font-size: 20px; font-weight: 700; }
  .stat-sub   { font-size: 10px; color: var(--muted); margin-top: 2px; }

  .session-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 24px; }
  .session-card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
  .session-name { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
  .session-wr   { font-size: 16px; font-weight: 700; }
  .session-n    { font-size: 10px; color: var(--muted); }

  /* ── Table ── */
  .table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--border); }
  table { width: 100%; border-collapse: collapse; background: var(--card); }
  thead th { background: #1c2128; padding: 10px 14px; text-align: left; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .6px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  tbody tr { border-bottom: 1px solid var(--border); transition: background .1s; }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: rgba(255,255,255,.03); }
  tbody td { padding: 10px 14px; font-size: 13px; white-space: nowrap; }
  tbody tr.win  td:first-child { border-left: 3px solid var(--green); }
  tbody tr.loss td:first-child { border-left: 3px solid var(--red); }
  tbody tr.pending td:first-child { border-left: 3px solid var(--amber); }

  .tag { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 4px; }
  .tag.s4  { background: rgba(0,212,255,.15); color: var(--c4); }
  .tag.s5  { background: rgba(255,107,53,.15); color: var(--c5); }
  .tag.up  { background: rgba(63,185,80,.15); color: var(--green); }
  .tag.down{ background: rgba(248,81,73,.15); color: var(--red); }
  .tag.win { background: rgba(63,185,80,.18); color: var(--green); }
  .tag.loss{ background: rgba(248,81,73,.18); color: var(--red); }
  .tag.doji{ background: rgba(227,179,65,.15); color: var(--amber); }
  .tag.pending { background: rgba(227,179,65,.1); color: var(--amber); }

  .empty-state { text-align: center; padding: 48px; color: var(--muted); font-size: 14px; }
  .countdown { font-variant-numeric: tabular-nums; }
  .refresh-note { font-size: 11px; color: var(--muted); }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="pulse" id="pulse"></div>
  <h1>BTC Fade <span>Live</span></h1>
  <div class="header-right">
    <span id="header-next">Next candle: —</span>
    <span id="header-time" class="refresh-note">—</span>
  </div>
</div>

<!-- Tab bar -->
<div class="tabs">
  <div class="tab active" data-tab="live">Live Signals</div>
  <div class="tab" data-tab="journal">Journal</div>
</div>

<!-- ══ LIVE PANEL ══════════════════════════════════════════════════════════ -->
<div class="panel active" id="panel-live">

  <div class="cards" id="live-cards">
    <div class="card"><div class="card-label">Today's Signals</div><div class="card-value" id="lc-today">—</div><div class="card-sub" id="lc-today-wr">—</div></div>
    <div class="card"><div class="card-label">Today Win Rate</div><div class="card-value" id="lc-wr">—</div><div class="card-sub" id="lc-pnl">—</div></div>
    <div class="card"><div class="card-label">Pending</div><div class="card-value" id="lc-pending">—</div><div class="card-sub">awaiting close</div></div>
    <div class="card"><div class="card-label">All-Time WR</div><div class="card-value" id="lc-allwr">—</div><div class="card-sub" id="lc-allpnl">—</div></div>
  </div>

  <div class="streak-bar" id="streak-bar">
    <div class="streak-dots" id="streak-dots"></div>
    <div class="streak-label" id="streak-label">Loading streak…</div>
    <div class="streak-signal none" id="streak-signal">No signal</div>
  </div>

  <div class="section-title">Recent Signals</div>
  <div id="recent-signals"></div>
</div>

<!-- ══ JOURNAL PANEL ═══════════════════════════════════════════════════════ -->
<div class="panel" id="panel-journal">

  <div class="journal-header">
    <div class="section-title" style="margin:0">Trade Journal</div>
    <div class="filter-row" id="filter-row">
      <button class="filter-btn active" data-f="all">All</button>
      <button class="filter-btn" data-f="S4-Fade">S4-Fade</button>
      <button class="filter-btn" data-f="S5-Fade">S5-Fade</button>
      <button class="filter-btn" data-f="WIN">Wins</button>
      <button class="filter-btn" data-f="LOSS">Losses</button>
      <button class="filter-btn" data-f="LONDON">London</button>
      <button class="filter-btn" data-f="LATE_NY">Late NY</button>
      <button class="filter-btn" data-f="ASIA">Asia</button>
    </div>
  </div>

  <div class="stat-row" id="stat-row"></div>
  <div class="section-title">By Session</div>
  <div class="session-grid" id="session-grid"></div>
  <div class="section-title">All Trades</div>
  <div class="table-wrap">
    <table id="journal-table">
      <thead>
        <tr>
          <th>Time (UTC)</th>
          <th>Strategy</th>
          <th>Session</th>
          <th>Day</th>
          <th>Direction</th>
          <th>Streak</th>
          <th>Entry</th>
          <th>Exit</th>
          <th>Move %</th>
          <th>EWR</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody id="journal-tbody"></tbody>
    </table>
  </div>

</div>

<script>
// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'journal') renderJournal();
  });
});

// ── Countdown ────────────────────────────────────────────────────────────────
let _nextClose = null;
function updateCountdown() {
  if (!_nextClose) return;
  const diff = Math.max(0, Math.round((_nextClose - Date.now()) / 1000));
  const m = Math.floor(diff / 60).toString().padStart(2, '0');
  const s = (diff % 60).toString().padStart(2, '0');
  document.getElementById('header-next').textContent = 'Next candle: ' + m + ':' + s;
}
setInterval(updateCountdown, 1000);

// ── Data ─────────────────────────────────────────────────────────────────────
let _journalData = { records: [], stats: {} };
let _activeFilter = 'all';

async function fetchAll() {
  try {
    const [status, journal] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/journal').then(r => r.json()),
    ]);
    _journalData = journal;
    applyStatus(status);
    renderLive(journal);
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.dataset.tab === 'journal') renderJournal();
    document.getElementById('header-time').textContent =
      'Updated ' + new Date().toLocaleTimeString();
  } catch (e) { console.error(e); }
}

// ── Status → Live panel ───────────────────────────────────────────────────────
function applyStatus(s) {
  if (s.next_candle_close) _nextClose = new Date(s.next_candle_close).getTime();
  const streak = s.streak || {};
  const len = streak.length || 0;
  const col = streak.colour || 'none';

  // Dots
  const dots = document.getElementById('streak-dots');
  dots.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('div');
    d.className = 'dot ' + (i < len ? col : 'empty');
    dots.appendChild(d);
  }

  // Label
  document.getElementById('streak-label').textContent =
    len > 0 ? `${len}-candle ${col} streak` : 'No active streak';

  // Signal badge
  const sig = document.getElementById('streak-signal');
  if (len >= 5) {
    sig.className = 'streak-signal s5'; sig.textContent = 'S5 SIGNAL';
  } else if (len >= 4) {
    sig.className = 'streak-signal s4'; sig.textContent = 'S4 SIGNAL';
  } else if (len === 3) {
    sig.className = 'streak-signal s4'; sig.textContent = '3-streak (watch)';
  } else {
    sig.className = 'streak-signal none'; sig.textContent = 'No signal';
  }

  document.getElementById('lc-pending').textContent = s.pending_count ?? '—';
}

function renderLive(data) {
  const stats = data.stats || {};
  const records = data.records || [];

  // Today's trades
  const today = new Date().toISOString().slice(0, 10);
  const todayRecs = records.filter(r => r.signal_time.startsWith(today));
  const todayRes  = todayRecs.filter(r => r.result === 'WIN' || r.result === 'LOSS');
  const todayWins = todayRes.filter(r => r.result === 'WIN').length;
  const todayWR   = todayRes.length ? (todayWins / todayRes.length * 100).toFixed(1) + '%' : '—';
  const todayPnl  = (todayWins - (todayRes.length - todayWins)) * 100;

  document.getElementById('lc-today').textContent = todayRecs.length;
  document.getElementById('lc-today-wr').textContent =
    todayRes.length ? `${todayWins}W / ${todayRes.length - todayWins}L` : 'no resolved yet';
  document.getElementById('lc-wr').textContent = todayWR;
  document.getElementById('lc-pnl').textContent =
    todayRes.length ? (todayPnl >= 0 ? '+' : '') + '$' + todayPnl.toLocaleString() : '—';
  document.getElementById('lc-allwr').textContent =
    stats.win_rate != null ? stats.win_rate + '%' : '—';
  document.getElementById('lc-allpnl').textContent =
    stats.pnl_100 != null ? (stats.pnl_100 >= 0 ? '+' : '') + '$' + stats.pnl_100.toLocaleString() : '—';

  // Recent signals (last 10)
  const container = document.getElementById('recent-signals');
  const recent = records.slice(0, 10);
  if (!recent.length) {
    container.innerHTML = '<div class="empty-state">No signals yet — watching for streaks…</div>';
    return;
  }
  container.innerHTML = recent.map(r => {
    const result = r.result || 'pending';
    const rowCls = result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : 'pending';
    const strat  = r.strategy.includes('S4') ? 's4' : 's5';
    const dirCls = r.direction === 'UP' ? 'up' : 'down';
    const dirArrow = r.direction === 'UP' ? '▲ UP' : '▼ DOWN';
    const t = r.signal_time.slice(11, 16) + ' UTC';
    const entry = r.entry_price ? r.entry_price.toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
    const exit  = r.exit_price  ? r.exit_price.toLocaleString(undefined,  {minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
    const dpct  = r.directed_pct != null
      ? `<span class="directed-pct ${r.directed_pct >= 0 ? 'pos' : 'neg'}">${r.directed_pct >= 0 ? '+' : ''}${r.directed_pct.toFixed(3)}%</span>`
      : '';
    const resultBadge = result === 'WIN' ? '<span class="result-badge win">WIN</span>'
                      : result === 'LOSS' ? '<span class="result-badge loss">LOSS</span>'
                      : result === 'DOJI' ? '<span class="result-badge doji">DOJI</span>'
                      : '<span class="result-badge pending">PENDING</span>';
    return `<div class="signal-row ${rowCls}">
      <span class="strat-badge ${strat}">${r.strategy}</span>
      <span class="dir-badge ${dirCls}">${dirArrow}</span>
      <span class="signal-meta">${t} · ${r.session} · ${r.day_of_week}</span>
      <span class="signal-price">${entry} → ${exit}</span>
      ${dpct}
      ${resultBadge}
    </div>`;
  }).join('');
}

// ── Journal ───────────────────────────────────────────────────────────────────
function renderJournal() {
  const { records = [], stats = {} } = _journalData;
  renderStats(stats);
  renderSessionGrid(stats);
  renderTable(records);
}

function renderStats(s) {
  const wr   = s.win_rate != null ? s.win_rate + '%' : '—';
  const pnl  = s.pnl_100 != null ? (s.pnl_100 >= 0 ? '+' : '') + '$' + s.pnl_100.toLocaleString() : '—';
  const s4wr = s.s4_total ? s.s4_wr + '%' : '—';
  const s5wr = s.s5_total ? s.s5_wr + '%' : '—';
  const pnlCol = s.pnl_100 >= 0 ? 'var(--green)' : 'var(--red)';
  const wrCol  = s.win_rate >= 57 ? 'var(--green)' : s.win_rate >= 50 ? 'var(--amber)' : 'var(--red)';

  document.getElementById('stat-row').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Trades</div><div class="stat-value">${s.total ?? 0}</div><div class="stat-sub">${s.wins ?? 0}W · ${s.losses ?? 0}L</div></div>
    <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value" style="color:${wrCol}">${wr}</div><div class="stat-sub">7d: ${s.wr_7d != null ? s.wr_7d + '%' : '—'} · 30d: ${s.wr_30d != null ? s.wr_30d + '%' : '—'}</div></div>
    <div class="stat-card"><div class="stat-label">P&amp;L ($100/trade)</div><div class="stat-value" style="color:${pnlCol}">${pnl}</div><div class="stat-sub">&nbsp;</div></div>
    <div class="stat-card"><div class="stat-label">S4-Fade WR</div><div class="stat-value" style="color:var(--c4)">${s4wr}</div><div class="stat-sub">${s.s4_total ?? 0} trades</div></div>
    <div class="stat-card"><div class="stat-label">S5-Fade WR</div><div class="stat-value" style="color:var(--c5)">${s5wr}</div><div class="stat-sub">${s.s5_total ?? 0} trades</div></div>
  `;
}

const SESSION_ORDER = ['ASIA','LONDON','OVERLAP','NY','LATE_NY'];
function renderSessionGrid(s) {
  const sess = s.sessions || {};
  document.getElementById('session-grid').innerHTML = SESSION_ORDER.map(name => {
    const d = sess[name] || {};
    const wr = d.wr != null ? d.wr + '%' : '—';
    const wrCol = d.wr >= 57 ? 'var(--green)' : d.wr >= 50 ? 'var(--amber)' : d.wr ? 'var(--red)' : 'var(--muted)';
    return `<div class="session-card">
      <div class="session-name">${name}</div>
      <div class="session-wr" style="color:${wrCol}">${wr}</div>
      <div class="session-n">${d.total ?? 0} trades · ${d.wins ?? 0}W</div>
    </div>`;
  }).join('');
}

function filterRecords(records) {
  const f = _activeFilter;
  if (f === 'all') return records;
  if (f === 'WIN' || f === 'LOSS') return records.filter(r => r.result === f);
  if (f === 'S4-Fade' || f === 'S5-Fade') return records.filter(r => r.strategy === f);
  return records.filter(r => r.session === f);  // session filter
}

function renderTable(records) {
  const filtered = filterRecords(records);
  const tbody = document.getElementById('journal-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No records match this filter.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(r => {
    const result = r.result || 'pending';
    const rowCls = result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : 'pending';
    const strat  = r.strategy.includes('S4') ? 's4' : 's5';
    const dirCls = r.direction === 'UP' ? 'up' : 'down';
    const dirArrow = r.direction === 'UP' ? '▲ UP' : '▼ DOWN';
    const t = r.signal_time.slice(0, 16).replace('T', ' ');
    const entry   = r.entry_price ? r.entry_price.toLocaleString(undefined,{minimumFractionDigits:2}) : '—';
    const exit    = r.exit_price  ? r.exit_price.toLocaleString(undefined, {minimumFractionDigits:2}) : '—';
    const dPct    = r.directed_pct != null ? (r.directed_pct >= 0 ? '+' : '') + r.directed_pct.toFixed(3) + '%' : '—';
    const dPctCol = r.directed_pct > 0 ? 'var(--green)' : r.directed_pct < 0 ? 'var(--red)' : 'var(--muted)';
    const ewr     = (r.expected_wr * 100).toFixed(1) + '%';
    const ewrCol  = r.expected_wr >= 0.59 ? 'var(--green)' : r.expected_wr >= 0.57 ? 'var(--amber)' : 'var(--muted)';
    return `<tr class="${rowCls}">
      <td>${t}</td>
      <td><span class="tag ${strat}">${r.strategy}</span></td>
      <td>${r.session}</td>
      <td>${(r.day_of_week || '').slice(0,3)}</td>
      <td><span class="tag ${dirCls}">${dirArrow}</span></td>
      <td>${r.streak_length}x ${r.streak_colour}</td>
      <td>${entry}</td>
      <td>${exit}</td>
      <td style="color:${dPctCol}">${dPct}</td>
      <td style="color:${ewrCol}">${ewr}</td>
      <td><span class="tag ${result.toLowerCase()}">${result}</span></td>
    </tr>`;
  }).join('');
}

// ── Filters ───────────────────────────────────────────────────────────────────
document.getElementById('filter-row').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _activeFilter = btn.dataset.f;
  renderTable(_journalData.records || []);
});

// ── Boot + refresh ────────────────────────────────────────────────────────────
fetchAll();
setInterval(fetchAll, 60_000);   // refresh every 60s to match poll cycle
</script>
</body>
</html>"""


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template_string(HTML)


@app.route("/api/status")
def api_status():
    with _status_lock:
        return jsonify(dict(_status))


@app.route("/api/journal")
def api_journal():
    return jsonify({
        "records": jstore.get_all(),
        "stats":   jstore.stats(),
    })


@app.route("/api/journal/recent")
def api_journal_recent():
    return jsonify(jstore.get_all(limit=20))


@app.route("/api/mock-trades")
def api_mock_trades():
    return jsonify({
        "records": mock_store.get_all(),
        "stats":   mock_store.stats(),
    })


# ── Start poll thread at module level so gunicorn picks it up ─────────────────
# (daemon=True means it dies automatically when the main process exits)
_poller = threading.Thread(target=_poll_loop, daemon=True, name="fade-poller")
_poller.start()
log.info("BTC Fade Detector started — http://localhost:5050")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=False, use_reloader=False)
