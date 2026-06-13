"""
Telegram alert module for BTC Fade mock trading.
Sends a message when a mock trade is PLACED and when it RESOLVES.
Uses urllib only — no extra dependencies.
"""
from __future__ import annotations
import json
import logging
import os
import urllib.request
import urllib.parse
from typing import Optional

log = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get(
    "TELEGRAM_BOT_TOKEN", "8381200262:AAEUJevCi8-6p6Y6xhu-Gj0IbP1lK-ZSvRQ"
)
TELEGRAM_CHAT_ID = os.environ.get(
    "TELEGRAM_CHAT_ID", "-1003621878454"
)

_BASE = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"


def _send(text: str, timeout: float = 8.0) -> bool:
    """POST a message to the configured chat. Returns True on success."""
    try:
        payload = json.dumps({
            "chat_id":    TELEGRAM_CHAT_ID,
            "text":       text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }).encode()
        req = urllib.request.Request(
            f"{_BASE}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read())
            if body.get("ok"):
                return True
            log.warning("[telegram] API error: %s", body)
            return False
    except Exception as exc:
        log.warning("[telegram] send failed: %s", exc)
        return False


# ── Direction helpers ─────────────────────────────────────────────────────────

def _dir_icon(direction: str) -> str:
    return "▲" if direction == "UP" else "▼"

def _result_icon(result: str) -> str:
    return "✅" if result == "WIN" else "❌"

def _streak_colour_icon(colour: str) -> str:
    return "🟢" if colour == "green" else "🔴"


# ── Public alert functions ────────────────────────────────────────────────────

def alert_trade_placed(
    *,
    strategy: str,
    direction: str,
    session: str,
    day_of_week: str,
    streak_colour: str,
    streak_length: int,
    entry_price: float,
    poly_odds: float,
    poly_payout: float,
    poly_market_slug: str,
    signal_time: str,
    stake: float = 10.0,
) -> None:
    """Fire when a mock trade is successfully registered."""
    odds_pct   = poly_odds * 100
    potential  = round(stake * (poly_payout - 1.0), 2)
    dir_icon   = _dir_icon(direction)
    colour_icon = _streak_colour_icon(streak_colour)

    # Polymarket URL — slug is the market identifier
    poly_url = f"https://polymarket.com/event/{poly_market_slug}"

    # Confidence label
    if poly_odds < 0.35:
        conf = "🔵 Contrarian (low odds — high payout)"
    elif poly_odds < 0.55:
        conf = "🟡 Near-50 (sweet spot)"
    elif poly_odds < 0.70:
        conf = "🟠 Market agrees — lower payout"
    else:
        conf = "🔴 Market very confident — low payout"

    text = (
        f"🎯 <b>MOCK TRADE PLACED</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>{strategy}</b>  {dir_icon} {direction}  |  {session}  |  {day_of_week[:3]}\n"
        f"Streak:  {colour_icon} {streak_length}× {streak_colour}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"Entry:    <b>${entry_price:,.2f}</b>\n"
        f"Poly odds: <b>{odds_pct:.1f}%</b>  →  Payout: <b>{poly_payout:.2f}×</b>\n"
        f"Stake:    ${stake:.2f}  →  Win target: <b>+${potential:.2f}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{conf}\n"
        f"📊 <a href=\"{poly_url}\">Verify on Polymarket</a>\n"
        f"<code>{poly_market_slug}</code>\n"
        f"⏰ {signal_time[:16].replace('T', ' ')} UTC"
    )
    _send(text)


def alert_trade_resolved(
    *,
    strategy: str,
    direction: str,
    session: str,
    day_of_week: str,
    entry_price: float,
    exit_price: Optional[float],
    directed_pct: Optional[float],
    poly_odds: float,
    poly_payout: float,
    result: str,
    profit: float,
    signal_time: str,
    resolved_at: Optional[str] = None,
) -> None:
    """Fire when a mock trade closes with WIN or LOSS."""
    dir_icon    = _dir_icon(direction)
    result_icon = _result_icon(result)
    odds_pct    = poly_odds * 100
    profit_str  = f"+${profit:.2f}" if profit >= 0 else f"-${abs(profit):.2f}"
    exit_str    = f"${exit_price:,.2f}" if exit_price is not None else "—"
    move_str    = (
        f"{directed_pct:+.3f}%" if directed_pct is not None else "—"
    )

    text = (
        f"{result_icon} <b>MOCK {result}  {profit_str}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>{strategy}</b>  {dir_icon} {direction}  |  {session}  |  {day_of_week[:3]}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"Entry:  <b>${entry_price:,.2f}</b>  →  Exit: <b>{exit_str}</b>\n"
        f"Move:   <b>{move_str}</b>\n"
        f"Poly:   {odds_pct:.1f}%  |  Payout: {poly_payout:.2f}×  |  P&amp;L: <b>{profit_str}</b>\n"
        f"⏰ {signal_time[:16].replace('T', ' ')} UTC"
    )
    _send(text)
