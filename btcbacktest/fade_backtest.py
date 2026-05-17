"""
Fade Backtest — S4-Fade & S5-Fade
===================================
After N consecutive same-color 15-min candles, bet the OPPOSITE direction.
Full breakdown: hour of day, day of week, session, month, year, cross-slices.
Binomial significance test on every bucket.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import pandas as pd
from scipy import stats
import plotly.graph_objects as go
from plotly.subplots import make_subplots

import data_fetcher, strategies

# ── constants ─────────────────────────────────────────────────────────────────
MIN_TRADES = 30
ALPHA      = 0.05
OUTPUT     = os.path.join(os.path.dirname(__file__), "fade_report.html")

BG    = "#0d1117"
CARD  = "#161b22"
TEXT  = "#e6edf3"
GRID  = "#30363d"
GREEN = "#3fb950"
RED   = "#f85149"
AMBER = "#e3b341"
C4    = "#00d4ff"   # S4-Fade colour
C5    = "#ff6b35"   # S5-Fade colour

SESSIONS = ["ASIA","LONDON","OVERLAP","NY","LATE_NY"]
DAYS     = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
MONTHS   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

# ── build fade trades ─────────────────────────────────────────────────────────

def make_fade(df3: pd.DataFrame, n: int) -> pd.DataFrame:
    """Identical signal as S4/S5, but direction is FLIPPED."""
    df15 = strategies._build_15min(df3)
    df   = df15.copy()
    df["color"] = np.sign(df["close"] - df["open"])

    shifted = [df["color"].shift(i) for i in range(1, n + 1)]
    streak  = shifted[0] != 0
    for c in shifted[1:]:
        streak = streak & (c == shifted[0])

    df["signal"]        = streak
    df["streak_dir"]    = shifted[0]          # direction of the streak
    df["fade_direction"]= -shifted[0]         # ← bet OPPOSITE

    sig = df[df["signal"] & (df["streak_dir"] != 0)].copy()

    # entry = open of prediction candle, exit = close of same candle
    sig["entry_price"]     = sig["open"]
    sig["exit_price"]      = sig["close"]
    sig["trade_direction"] = sig["fade_direction"]
    sig["pct_move"]        = (sig["exit_price"] - sig["entry_price"]) / sig["entry_price"]
    sig["directed_pct"]    = sig["pct_move"] * sig["trade_direction"]
    sig["win"]             = sig["directed_pct"] > 0
    sig["result"]          = np.where(sig["win"], 1, -1)

    sig["dt"]          = pd.to_datetime(sig["timestamp"], unit="s", utc=True)
    sig["hour"]        = sig["dt"].dt.hour
    sig["day_of_week"] = sig["dt"].dt.dayofweek
    sig["month"]       = sig["dt"].dt.month
    sig["year"]        = sig["dt"].dt.year
    sig["session"]     = sig["hour"].map(_session)
    sig["day_name"]    = sig["day_of_week"].map(lambda x: DAYS[x])
    sig["month_name"]  = sig["month"].map(lambda x: MONTHS[x - 1])

    return sig.reset_index(drop=True)


def _session(h):
    for name, lo, hi in [("ASIA",0,8),("LONDON",8,13),("OVERLAP",13,16),
                          ("NY",16,21),("LATE_NY",21,24)]:
        if lo <= h < hi: return name
    return "LATE_NY"

# ── metrics ───────────────────────────────────────────────────────────────────

def metrics(t: pd.DataFrame, label="") -> dict:
    if t.empty: return {"label": label, "trades": 0}
    wins  = t["win"].sum()
    total = len(t)
    wr    = wins / total
    wp    = t[t["win"]]["directed_pct"]
    lp    = t[~t["win"]]["directed_pct"]
    pf    = wp.sum() / abs(lp.sum()) if lp.sum() != 0 else np.inf

    eq   = (t["result"] * 100).cumsum()
    peak = eq.cummax()
    mdd  = (eq - peak).min()

    t2 = t.copy()
    t2["date"] = t2["dt"].dt.normalize()
    daily  = t2.groupby("date")["result"].sum() * 100
    sharpe = (daily.mean() / daily.std() * np.sqrt(252)) if daily.std() > 0 else 0.0
    span   = max((t["dt"].max() - t["dt"].min()).days, 1)

    return {
        "label": label, "trades": total,
        "win_rate": wr, "avg_win": wp.mean() * 100 if len(wp) else 0,
        "avg_loss": lp.mean() * 100 if len(lp) else 0,
        "profit_factor": pf, "sharpe": sharpe,
        "max_dd": mdd, "net_pnl": eq.iloc[-1],
        "trades_per_day": total / span,
        "equity": eq, "dates": t["dt"].values,
    }


def binom_p(wins, n):
    if n == 0: return 1.0
    return float(stats.binomtest(int(wins), int(n), 0.5, alternative="two-sided").pvalue)


def slice_stats(t: pd.DataFrame, col: str, order: list | None = None) -> pd.DataFrame:
    g = (t.groupby(col)
          .agg(n=("win","count"), wins=("win","sum"))
          .reset_index())
    g["wr"]     = g["wins"] / g["n"]
    g["edge"]   = (g["wr"] - 0.5) * 100
    g["p"]      = g.apply(lambda r: binom_p(r.wins, r.n), axis=1)
    g["p_bonf"] = (g["p"] * len(g)).clip(upper=1)
    g["sig"]    = g["p_bonf"] < ALPHA
    if order:
        g[col] = pd.Categorical(g[col], categories=order, ordered=True)
        g = g.sort_values(col).reset_index(drop=True)
    return g

# ── chart helpers ─────────────────────────────────────────────────────────────

def _layout(fig, title="", height=400):
    fig.update_layout(
        title=dict(text=title, font=dict(color=TEXT, size=15)),
        paper_bgcolor=CARD, plot_bgcolor=BG,
        font=dict(color=TEXT, family="monospace"),
        height=height,
        margin=dict(l=55, r=20, t=48, b=55),
        legend=dict(bgcolor="rgba(0,0,0,0)"),
        xaxis=dict(gridcolor=GRID, zerolinecolor=GRID),
        yaxis=dict(gridcolor=GRID, zerolinecolor=GRID),
    )
    return fig

# ── individual charts ─────────────────────────────────────────────────────────

def chart_equity(t4, t5):
    fig = go.Figure()
    for t, col, name in [(t4, C4, "S4-Fade (4-consec reverse)"),
                          (t5, C5, "S5-Fade (5-consec reverse)")]:
        eq = (t["result"] * 100).cumsum()
        fig.add_trace(go.Scatter(
            x=t["dt"].values, y=eq.values,
            name=name, line=dict(color=col, width=2),
            hovertemplate="%{x|%Y-%m-%d}<br>$%{y:,.0f}<extra></extra>",
        ))
    fig.add_hline(y=0, line_color=GRID, line_width=1)
    _layout(fig, "Cumulative Equity — $100 per trade", 420)
    return fig.to_html(full_html=False, include_plotlyjs=False)


def chart_drawdown(t4, t5):
    fig = go.Figure()
    for t, col, name in [(t4, C4, "S4-Fade"), (t5, C5, "S5-Fade")]:
        eq   = (t["result"] * 100).cumsum()
        dd   = eq - eq.cummax()
        rgba = col.replace("#","")
        r,g,b = int(rgba[0:2],16), int(rgba[2:4],16), int(rgba[4:6],16)
        fig.add_trace(go.Scatter(
            x=t["dt"].values, y=dd.values, name=name,
            line=dict(color=col, width=1),
            fill="tozeroy",
            fillcolor=f"rgba({r},{g},{b},0.10)",
        ))
    _layout(fig, "Drawdown ($)", 320)
    return fig.to_html(full_html=False, include_plotlyjs=False)


def chart_hourly(t4, t5):
    fig = go.Figure()
    hours = list(range(24))
    for t, col, name in [(t4, C4, "S4-Fade"), (t5, C5, "S5-Fade")]:
        s = slice_stats(t, "hour").set_index("hour").reindex(hours)
        wr  = s["wr"].values * 100
        sig = s["sig"].fillna(False).values
        n   = s["n"].fillna(0).values
        fig.add_trace(go.Scatter(
            x=hours, y=wr, name=name,
            line=dict(color=col, width=2), mode="lines",
            customdata=np.stack([n, s["p_bonf"].fillna(1).values], axis=-1),
            hovertemplate="Hour %{x}:00 UTC<br>Win Rate: %{y:.1f}%<br>"
                          "Trades: %{customdata[0]:.0f}<br>p(Bonf): %{customdata[1]:.4f}<extra></extra>",
        ))
        # highlight significant hours
        xs = [h for h, sv in zip(hours, sig) if sv and n[h] >= MIN_TRADES]
        ys = [wr[h] for h in xs]
        if xs:
            fig.add_trace(go.Scatter(
                x=xs, y=ys, mode="markers", showlegend=False,
                marker=dict(color=col, size=11, symbol="circle",
                            line=dict(width=2, color="white")),
            ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID, annotation_text="50%")
    fig.add_hrect(y0=52, y1=80, fillcolor=GREEN, opacity=0.04, line_width=0)
    fig.update_xaxes(tickmode="linear", dtick=1, title="Hour (UTC)")
    fig.update_yaxes(title="Win Rate (%)", range=[30, 75])
    _layout(fig, "Win Rate by Hour of Day (UTC)  |  circled dots = p<0.05 Bonferroni", 430)
    fig.update_layout(hovermode="x unified")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def chart_dow(t4, t5):
    fig = go.Figure()
    for t, col, name in [(t4, C4, "S4-Fade"), (t5, C5, "S5-Fade")]:
        s   = slice_stats(t, "day_of_week").set_index("day_of_week").reindex(range(7))
        wr  = s["wr"].fillna(0.5).values * 100
        sig = s["sig"].fillna(False).values
        n   = s["n"].fillna(0).values
        xlabels = [f"{d}{'*' if sv else ''}" for d, sv in zip(DAYS, sig)]
        fig.add_trace(go.Bar(
            x=xlabels, y=wr, name=name,
            marker_color=col, opacity=0.85,
            customdata=n,
            hovertemplate="%{x}<br>Win Rate: %{y:.1f}%<br>Trades: %{customdata:.0f}<extra></extra>",
        ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID)
    fig.update_yaxes(title="Win Rate (%)", range=[30, 75])
    _layout(fig, "Win Rate by Day of Week  (* = significant)", 380)
    fig.update_layout(barmode="group")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def chart_session(t4, t5):
    fig = go.Figure()
    for t, col, name in [(t4, C4, "S4-Fade"), (t5, C5, "S5-Fade")]:
        s   = slice_stats(t, "session", SESSIONS).set_index("session").reindex(SESSIONS)
        wr  = s["wr"].fillna(0.5).values * 100
        sig = s["sig"].fillna(False).values
        n   = s["n"].fillna(0).values
        xlabels = [f"{ss}{'*' if sv else ''}" for ss, sv in zip(SESSIONS, sig)]
        fig.add_trace(go.Bar(
            x=xlabels, y=wr, name=name,
            marker_color=col, opacity=0.85,
            customdata=n,
            hovertemplate="%{x}<br>Win Rate: %{y:.1f}%<br>Trades: %{customdata:.0f}<extra></extra>",
        ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID)
    fig.update_yaxes(title="Win Rate (%)", range=[30, 75])
    _layout(fig, "Win Rate by Session  (* = significant)", 380)
    fig.update_layout(barmode="group")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def chart_monthly(t4, t5):
    fig = go.Figure()
    for t, col, name in [(t4, C4, "S4-Fade"), (t5, C5, "S5-Fade")]:
        s   = slice_stats(t, "month").set_index("month").reindex(range(1, 13))
        wr  = s["wr"].fillna(0.5).values * 100
        sig = s["sig"].fillna(False).values
        n   = s["n"].fillna(0).values
        xlabels = [f"{m}{'*' if sv else ''}" for m, sv in zip(MONTHS, sig)]
        fig.add_trace(go.Bar(
            x=xlabels, y=wr, name=name,
            marker_color=col, opacity=0.85,
            customdata=n,
            hovertemplate="%{x}<br>Win Rate: %{y:.1f}%<br>Trades: %{customdata:.0f}<extra></extra>",
        ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID)
    fig.update_yaxes(title="Win Rate (%)", range=[30, 75])
    _layout(fig, "Win Rate by Month of Year  (* = significant)", 380)
    fig.update_layout(barmode="group")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def chart_yearly(t4, t5):
    fig = go.Figure()
    for t, col, name in [(t4, C4, "S4-Fade"), (t5, C5, "S5-Fade")]:
        s  = slice_stats(t, "year")
        wr = s["wr"].values * 100
        n  = s["n"].values
        fig.add_trace(go.Bar(
            x=s["year"].astype(str), y=wr, name=name,
            marker_color=col, opacity=0.85,
            customdata=n,
            hovertemplate="%{x}<br>Win Rate: %{y:.1f}%<br>Trades: %{customdata:.0f}<extra></extra>",
        ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID)
    fig.update_yaxes(title="Win Rate (%)", range=[30, 75])
    _layout(fig, "Win Rate by Year", 340)
    fig.update_layout(barmode="group")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def heatmap_hour_dow(t, title, color):
    """24 hours × 7 days win-rate heatmap for a single strategy."""
    rows = []
    for d in range(7):
        for h in range(24):
            sub = t[(t["day_of_week"] == d) & (t["hour"] == h)]
            n = len(sub)
            wr = sub["win"].mean() if n >= MIN_TRADES else np.nan
            p  = binom_p(sub["win"].sum(), n) * (24 * 7) if n >= MIN_TRADES else 1.0
            sig = p < ALPHA and n >= MIN_TRADES
            rows.append({"day": DAYS[d], "hour": h, "wr": wr, "n": n, "sig": sig})
    df = pd.DataFrame(rows)

    z, text = [], []
    for d in DAYS:
        zrow, trow = [], []
        for h in range(24):
            v = df[(df["day"]==d) & (df["hour"]==h)]
            wr_val = v["wr"].values[0]
            sig    = v["sig"].values[0]
            if np.isnan(wr_val):
                zrow.append(np.nan); trow.append("")
            else:
                zrow.append(wr_val * 100)
                trow.append(f"{wr_val*100:.0f}{'*' if sig else ''}")
        z.append(zrow); text.append(trow)

    fig = go.Figure(go.Heatmap(
        z=z, x=list(range(24)), y=DAYS,
        text=text, texttemplate="%{text}", textfont=dict(size=10),
        colorscale=[[0, RED],[0.5,"#2d3748"],[1, GREEN]],
        zmid=50, zmin=35, zmax=65,
        colorbar=dict(title="Win %", tickfont=dict(color=TEXT)),
    ))
    _layout(fig, title, height=320)
    fig.update_xaxes(tickmode="linear", dtick=2, title="Hour (UTC)")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def heatmap_hour_session(t, title):
    rows = []
    for s in SESSIONS:
        for h in range(24):
            sub = t[(t["session"]==s) & (t["hour"]==h)]
            n = len(sub)
            wr = sub["win"].mean() if n >= MIN_TRADES else np.nan
            rows.append({"session": s, "hour": h, "wr": wr, "n": n})
    df = pd.DataFrame(rows)
    z, text = [], []
    for s in SESSIONS:
        zrow, trow = [], []
        for h in range(24):
            v = df[(df["session"]==s) & (df["hour"]==h)]
            wr_val = v["wr"].values[0]
            if np.isnan(wr_val):
                zrow.append(np.nan); trow.append("")
            else:
                zrow.append(wr_val * 100)
                trow.append(f"{wr_val*100:.0f}")
        z.append(zrow); text.append(trow)
    fig = go.Figure(go.Heatmap(
        z=z, x=list(range(24)), y=SESSIONS,
        text=text, texttemplate="%{text}", textfont=dict(size=10),
        colorscale=[[0, RED],[0.5,"#2d3748"],[1, GREEN]],
        zmid=50, zmin=35, zmax=65,
        colorbar=dict(title="Win %", tickfont=dict(color=TEXT)),
    ))
    _layout(fig, title, height=260)
    fig.update_xaxes(tickmode="linear", dtick=2, title="Hour (UTC)")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def build_ranked_table(t4, t5):
    rows = []
    dims = [
        ("hour",        "Hour (UTC)", None),
        ("day_of_week", "Day of Week", DAYS),
        ("session",     "Session",    SESSIONS),
        ("month",       "Month",      MONTHS),
        ("year",        "Year",       None),
    ]
    for t, label in [(t4, "S4-Fade (4-consec)"), (t5, "S5-Fade (5-consec)")]:
        for col, dim_name, order in dims:
            s = slice_stats(t, col)
            for _, r in s.iterrows():
                if r["n"] < MIN_TRADES: continue
                bkt = r[col]
                if col == "day_of_week": bkt = DAYS[int(bkt)]
                elif col == "month":     bkt = MONTHS[int(bkt)-1]
                elif col == "year":      bkt = str(int(bkt))
                rows.append({
                    "Strategy": label, "Dimension": dim_name, "Bucket": str(bkt),
                    "Trades": int(r["n"]), "Win Rate": r["wr"],
                    "Edge": r["edge"], "p (Bonf)": r["p_bonf"], "Sig": r["sig"],
                })
    df = pd.DataFrame(rows).sort_values("p (Bonf)")
    return df


def ranked_table_html(df):
    sig   = df[df["Sig"]].copy()
    other = df[~df["Sig"]].head(40)

    def row_html(r, hl):
        wr = r["Win Rate"] * 100
        wc = GREEN if wr > 52 else (RED if wr < 48 else TEXT)
        pv = r["p (Bonf)"]
        ps = f"{pv:.4f}" if pv >= 0.0001 else "<0.0001"
        bg = "background:#1a2635;" if hl else ""
        sc = C4 if "S4" in r["Strategy"] else C5
        return (
            f'<tr style="{bg}">'
            f'<td><span class="badge" style="border-color:{sc}">{r["Strategy"]}</span></td>'
            f'<td>{r["Dimension"]}</td>'
            f'<td><b>{r["Bucket"]}</b></td>'
            f'<td>{r["Trades"]:,}</td>'
            f'<td style="color:{wc};font-weight:bold">{wr:.1f}%</td>'
            f'<td style="color:{wc}">{r["Edge"]:+.1f}%</td>'
            f'<td>{ps}</td>'
            f'<td style="color:{GREEN if r["Sig"] else AMBER}">{"YES" if r["Sig"] else "-"}</td>'
            f'</tr>'
        )

    head = ("<thead><tr>"
            "<th>Strategy</th><th>Dimension</th><th>Bucket</th>"
            "<th>Trades</th><th>Win Rate</th><th>Edge</th><th>p (Bonf)</th><th>Sig</th>"
            "</tr></thead>")

    sig_rows   = "".join(row_html(r, True)  for _, r in sig.iterrows())
    other_rows = "".join(row_html(r, False) for _, r in other.iterrows())

    return f"""
<h3 style="color:{GREEN};margin:0 0 10px">Statistically Significant (p &lt; {ALPHA} after Bonferroni)</h3>
<div class="table-wrap">
  <table class="t">{head}<tbody>{sig_rows}</tbody></table>
</div>
<h3 style="color:{AMBER};margin:24px 0 10px">All Slices Ranked by p-value (top 40)</h3>
<div class="table-wrap">
  <table class="t">{head}<tbody>{other_rows}</tbody></table>
</div>"""


# ── HTML generation ───────────────────────────────────────────────────────────

def write_report(m4, m5, t4, t5,
                 eq_html, dd_html, hourly_html, dow_html,
                 sess_html, monthly_html, yearly_html,
                 hm4_dowhour, hm5_dowhour,
                 hm4_sesshour, hm5_sesshour,
                 table_html):

    def card(m, color):
        wr = m["win_rate"] * 100
        return f"""
        <div class="card">
          <div class="card-title" style="color:{color}">{m["label"]}</div>
          <div class="card-grid">
            <div class="stat"><span class="sv" style="color:{GREEN if wr>52 else RED}">{wr:.1f}%</span><span class="sl">Win Rate</span></div>
            <div class="stat"><span class="sv">{m["trades"]:,}</span><span class="sl">Total Trades</span></div>
            <div class="stat"><span class="sv">{m["trades_per_day"]:.1f}</span><span class="sl">Trades/Day</span></div>
            <div class="stat"><span class="sv">{m["sharpe"]:.2f}</span><span class="sl">Sharpe</span></div>
            <div class="stat"><span class="sv" style="color:{GREEN}">{m["avg_win"]:.4f}%</span><span class="sl">Avg Win</span></div>
            <div class="stat"><span class="sv" style="color:{RED}">{m["avg_loss"]:.4f}%</span><span class="sl">Avg Loss</span></div>
            <div class="stat"><span class="sv" style="color:{RED}">${m["max_dd"]:,.0f}</span><span class="sl">Max DD</span></div>
            <div class="stat"><span class="sv" style="color:{GREEN if m['net_pnl']>0 else RED}">${m["net_pnl"]:,.0f}</span><span class="sl">Net P&L</span></div>
          </div>
        </div>"""

    css = f"""
    *,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
    body{{background:{BG};color:{TEXT};font-family:'Courier New',monospace;font-size:14px}}
    header{{background:{CARD};border-bottom:1px solid {GRID};padding:20px 32px}}
    header h1{{font-size:22px;color:#fff}}
    header .sub{{color:#8b949e;margin-top:4px;font-size:13px}}
    nav{{background:{CARD};border-bottom:1px solid {GRID};padding:0 32px;
         display:flex;gap:0;position:sticky;top:0;z-index:100}}
    nav a{{display:block;padding:11px 16px;color:#8b949e;text-decoration:none;
           font-size:13px;border-bottom:2px solid transparent}}
    nav a:hover{{color:{TEXT};border-bottom-color:{C4}}}
    .container{{max-width:1400px;margin:0 auto;padding:24px 32px}}
    section{{margin-bottom:40px}}
    h2{{font-size:16px;color:#fff;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid {GRID}}}
    h3{{font-size:13px;font-weight:bold}}
    .cards{{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:8px}}
    .card{{background:{CARD};border:1px solid {GRID};border-radius:8px;padding:20px}}
    .card-title{{font-size:15px;font-weight:bold;margin-bottom:14px}}
    .card-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}}
    .stat{{display:flex;flex-direction:column;gap:3px}}
    .sv{{font-size:16px;font-weight:bold}}
    .sl{{font-size:11px;color:#8b949e}}
    .box{{background:{CARD};border:1px solid {GRID};border-radius:8px;padding:16px;margin-bottom:16px;overflow:hidden}}
    .grid2{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
    .table-wrap{{overflow-x:auto;margin-bottom:8px}}
    .t{{width:100%;border-collapse:collapse;font-size:12.5px}}
    .t th{{background:#1c2128;color:#8b949e;padding:8px 12px;text-align:left;
           font-weight:normal;white-space:nowrap}}
    .t td{{padding:8px 12px;border-top:1px solid {GRID};white-space:nowrap}}
    .t tr:hover td{{background:#1c2128}}
    .badge{{background:#21262d;border:1px solid {GRID};border-radius:4px;
            padding:2px 7px;font-size:11px}}
    .note{{background:#1c2128;border-left:3px solid {AMBER};padding:12px 16px;
           margin-bottom:20px;font-size:13px;line-height:1.6;border-radius:0 4px 4px 0}}
    """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BTC Fade Backtest — S4 & S5 Inverse</title>
<script src="https://cdn.plot.ly/plotly-2.26.0.min.js"></script>
<style>{css}</style>
</head>
<body>
<header>
  <h1>BTC/USD Fade Strategies — S4-Fade &amp; S5-Fade</h1>
  <div class="sub">After N consecutive same-color 15-min candles, bet the OPPOSITE direction &nbsp;|&nbsp;
    5 years (Binance BTCUSDT) &nbsp;|&nbsp; Binomial test, Bonferroni-corrected</div>
</header>
<nav>
  <a href="#overview">Overview</a>
  <a href="#equity">Equity</a>
  <a href="#hourly">Hourly</a>
  <a href="#dow">Day of Week</a>
  <a href="#session">Session</a>
  <a href="#monthly">Monthly</a>
  <a href="#heatmaps">Heatmaps</a>
  <a href="#ranked">Ranked Table</a>
</nav>
<div class="container">

<section id="overview">
  <h2>Strategy Overview</h2>
  <div class="note">
    <b>Signal:</b> When N consecutive 15-min candles close in the same direction (all green or all red),
    bet the <b>next candle reverses</b>. Entry = open of prediction candle, exit = close of same candle.<br>
    S4-Fade: N=4 &nbsp;|&nbsp; S5-Fade: N=5
  </div>
  <div class="cards">
    {card(m4, C4)}
    {card(m5, C5)}
  </div>
</section>

<section id="equity">
  <h2>Equity &amp; Drawdown</h2>
  <div class="box">{eq_html}</div>
  <div class="box">{dd_html}</div>
</section>

<section id="hourly">
  <h2>Win Rate by Hour of Day (UTC)</h2>
  <div class="box">{hourly_html}</div>
</section>

<section id="dow">
  <h2>Win Rate by Day of Week</h2>
  <div class="box">{dow_html}</div>
</section>

<section id="session">
  <h2>Win Rate by Session</h2>
  <div class="box">{sess_html}</div>
</section>

<section id="monthly">
  <h2>Win Rate by Month &amp; Year</h2>
  <div class="box">{monthly_html}</div>
  <div class="box">{yearly_html}</div>
</section>

<section id="heatmaps">
  <h2>Hour x Day-of-Week Heatmaps</h2>
  <div class="grid2">
    <div class="box">{hm4_dowhour}</div>
    <div class="box">{hm5_dowhour}</div>
  </div>
  <h2 style="margin-top:24px">Session x Hour Heatmaps</h2>
  <div class="grid2">
    <div class="box">{hm4_sesshour}</div>
    <div class="box">{hm5_sesshour}</div>
  </div>
</section>

<section id="ranked">
  <h2>All Slices — Ranked by Edge Strength</h2>
  {table_html}
</section>

</div>
</body>
</html>"""

    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  Saved: {OUTPUT}")


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    print("Loading data...")
    df3 = data_fetcher.load_data(years=5)

    print("Building fade trade sets...")
    t4 = make_fade(df3, n=4)
    t5 = make_fade(df3, n=5)
    print(f"  S4-Fade: {len(t4):,} trades")
    print(f"  S5-Fade: {len(t5):,} trades")

    m4 = metrics(t4, "S4-Fade (4-consec reverse)")
    m5 = metrics(t5, "S5-Fade (5-consec reverse)")

    print(f"\n{'Metric':<22} {'S4-Fade':>12} {'S5-Fade':>12}")
    print("-" * 48)
    for k in ("trades","win_rate","sharpe","max_dd","net_pnl","trades_per_day"):
        v4, v5 = m4[k], m5[k]
        if k == "win_rate":
            print(f"  {k:<20} {v4*100:>11.2f}% {v5*100:>11.2f}%")
        elif k in ("max_dd","net_pnl"):
            print(f"  {k:<20} ${v4:>10,.0f} ${v5:>10,.0f}")
        elif k == "trades":
            print(f"  {k:<20} {v4:>12,} {v5:>12,}")
        else:
            print(f"  {k:<20} {v4:>12.2f} {v5:>12.2f}")

    print("\nBuilding charts...")
    eq_html      = chart_equity(t4, t5)
    dd_html      = chart_drawdown(t4, t5)
    hourly_html  = chart_hourly(t4, t5)
    dow_html     = chart_dow(t4, t5)
    sess_html    = chart_session(t4, t5)
    monthly_html = chart_monthly(t4, t5)
    yearly_html  = chart_yearly(t4, t5)
    hm4_dh       = heatmap_hour_dow(t4, "S4-Fade  |  Day x Hour Win Rate", C4)
    hm5_dh       = heatmap_hour_dow(t5, "S5-Fade  |  Day x Hour Win Rate", C5)
    hm4_sh       = heatmap_hour_session(t4, "S4-Fade  |  Session x Hour Win Rate")
    hm5_sh       = heatmap_hour_session(t5, "S5-Fade  |  Session x Hour Win Rate")

    print("Ranking slices...")
    ranked_df    = build_ranked_table(t4, t5)
    table_html   = ranked_table_html(ranked_df)

    print("\nSignificant slices (Bonferroni p<0.05):")
    sig = ranked_df[ranked_df["Sig"]]
    print(f"  {'Strategy':<26} {'Dim':<13} {'Bucket':<8} {'N':>6} {'WR':>7} {'Edge':>7}")
    print("  " + "-"*72)
    for _, r in sig.iterrows():
        print(f"  {r['Strategy']:<26} {r['Dimension']:<13} {str(r['Bucket']):<8} "
              f"{r['Trades']:>6,} {r['Win Rate']*100:>6.1f}% {r['Edge']:>+6.1f}%")

    print("\nGenerating report...")
    write_report(m4, m5, t4, t5,
                 eq_html, dd_html, hourly_html, dow_html,
                 sess_html, monthly_html, yearly_html,
                 hm4_dh, hm5_dh, hm4_sh, hm5_sh,
                 table_html)


if __name__ == "__main__":
    main()
