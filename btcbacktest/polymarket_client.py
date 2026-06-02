"""
Thin HTTP client — fetches current BTC 15m Polymarket odds from the local Node.js backend.
"""
from __future__ import annotations
import logging
import os
import requests

log = logging.getLogger(__name__)

NODE_BASE      = os.environ.get("NODE_API_URL", "http://localhost:3001")
POLY_ENDPOINT  = f"{NODE_BASE}/api/polymarket/current"


def fetch_odds(timeout: float = 5.0) -> dict | None:
    """
    Returns a dict with at minimum:
      oddsUp, oddsDown, payoutUp, payoutDown, slug, lastUpdated
    Returns None if the Node backend is unreachable or no active market found.
    """
    try:
        r = requests.get(POLY_ENDPOINT, timeout=timeout)
        if r.status_code == 200:
            return r.json()
        log.warning("[poly-client] HTTP %s from %s", r.status_code, POLY_ENDPOINT)
        return None
    except Exception as exc:
        log.warning("[poly-client] %s", exc)
        return None
