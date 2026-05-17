"""
Generates a self-contained HTML report with Plotly charts.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots

import analysis as an

# ── colour palette ────────────────────────────────────────────────────────────
COLORS = ["#00d4ff", "#ff6b35", "#7bc67e", "#ffd166", "#c77dff"]
BG = "#0d1117"
CARD = "#161b22"
TEXT = "#e6edf3"
GRID = "#30363d"
GREEN = "#3fb950"
RED = "#f85149"

STRATEGY_NAMES = {
    "S1_Size_Breakout":  "S1 — 1H Size Breakout",
    "S2_Trend_Size":     "S2 — 1H Trend + Size",
    "S3_Window_Breakout":"S3 — 15M Window Breakout",
    "S4_4_Consecutive":  "S4 — 4 Consecutive",
    "S5_5_Consecutive":  "S5 — 5 Consecutive",
}

SESSION_ORDER = ["ASIA", "LONDON", "OVERLAP", "NY", "LATE_NY"]
DOW_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTH_ORDER = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]


def _layout(fig, title="", height=420):
    fig.update_layout(
        title=dict(text=title, font=dict(color=TEXT, size=16)),
        paper_bgcolor=CARD,
        plot_bgcolor=BG,
        font=dict(color=TEXT, family="monospace"),
        height=height,
        margin=dict(l=50, r=20, t=50, b=50),
        legend=dict(bgcolor="rgba(0,0,0,0)", bordercolor=GRID),
        xaxis=dict(gridcolor=GRID, zerolinecolor=GRID),
        yaxis=dict(gridcolor=GRID, zerolinecolor=GRID),
    )
    return fig


# ─────────────────────────── chart builders ───────────────────────────────────

def _equity_chart(all_trades: dict[str, pd.DataFrame]) -> str:
    fig = go.Figure()
    for i, (key, trades) in enumerate(all_trades.items()):
        eq = an.equity_series(trades)
        if eq.empty:
            continue
        fig.add_trace(go.Scatter(
            x=eq.index, y=eq.values,
            name=STRATEGY_NAMES.get(key, key),
            line=dict(color=COLORS[i % len(COLORS)], width=1.5),
            hovertemplate="%{x|%Y-%m-%d}<br>$%{y:.0f}<extra></extra>",
        ))
    fig.add_hline(y=0, line_color=GRID, line_width=1)
    _layout(fig, "Cumulative Equity — $100 per trade (binary)", height=450)
    fig.update_layout(hovermode="x unified")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def _drawdown_chart(all_trades: dict[str, pd.DataFrame]) -> str:
    fig = go.Figure()
    for i, (key, trades) in enumerate(all_trades.items()):
        if trades.empty:
            continue
        eq = (trades["result"] * 100).cumsum()
        dd = eq - eq.cummax()
        fig.add_trace(go.Scatter(
            x=trades["dt"].values, y=dd.values,
            name=STRATEGY_NAMES.get(key, key),
            line=dict(color=COLORS[i % len(COLORS)], width=1),
            fill="tozeroy",
            fillcolor=COLORS[i % len(COLORS)].replace(")", ",0.08)").replace("rgb", "rgba"),
            hovertemplate="%{x|%Y-%m-%d}<br>$%{y:.0f}<extra></extra>",
        ))
    _layout(fig, "Drawdown ($)", height=350)
    return fig.to_html(full_html=False, include_plotlyjs=False)


def _session_heatmap(all_trades: dict[str, pd.DataFrame]) -> str:
    strats = list(all_trades.keys())
    data = []
    for s in SESSION_ORDER:
        row = []
        for key in strats:
            t = all_trades[key]
            sub = t[t["session"] == s]
            row.append(round(sub["win"].mean() * 100, 1) if len(sub) >= 5 else np.nan)
        data.append(row)

    z = np.array(data, dtype=float)
    text = [[f"{v:.1f}%" if not np.isnan(v) else "—" for v in row] for row in z]
    labels = [STRATEGY_NAMES.get(k, k) for k in strats]

    fig = go.Figure(go.Heatmap(
        z=z, x=labels, y=SESSION_ORDER,
        text=text, texttemplate="%{text}",
        colorscale=[[0, RED], [0.5, "#444"], [1, GREEN]],
        zmid=50, zmin=40, zmax=60,
        colorbar=dict(title="Win %", tickfont=dict(color=TEXT)),
    ))
    _layout(fig, "Win Rate by Session (%)", height=320)
    return fig.to_html(full_html=False, include_plotlyjs=False)


def _hourly_chart(all_trades: dict[str, pd.DataFrame]) -> str:
    fig = go.Figure()
    for i, (key, trades) in enumerate(all_trades.items()):
        if trades.empty:
            continue
        hb = an.hourly_breakdown(trades).sort_values("hour")
        hb = hb[hb["trades_n"] >= 5]
        fig.add_trace(go.Scatter(
            x=hb["hour"], y=hb["win_rate"] * 100,
            name=STRATEGY_NAMES.get(key, key),
            line=dict(color=COLORS[i % len(COLORS)]),
            mode="lines+markers",
        ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID, annotation_text="50%")
    fig.update_xaxes(tickmode="linear", dtick=2, title="Hour (UTC)")
    fig.update_yaxes(title="Win Rate (%)", range=[35, 65])
    _layout(fig, "Win Rate by Hour of Day (UTC)", height=380)
    return fig.to_html(full_html=False, include_plotlyjs=False)


def _dow_chart(all_trades: dict[str, pd.DataFrame]) -> str:
    fig = go.Figure()
    x = DOW_ORDER
    for i, (key, trades) in enumerate(all_trades.items()):
        if trades.empty:
            continue
        db = an.dow_breakdown(trades)
        db = db.set_index("day_of_week").reindex(range(7)).reset_index()
        fig.add_trace(go.Bar(
            x=x, y=db["win_rate"] * 100,
            name=STRATEGY_NAMES.get(key, key),
            marker_color=COLORS[i % len(COLORS)],
            opacity=0.85,
        ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID)
    fig.update_yaxes(title="Win Rate (%)", range=[35, 65])
    _layout(fig, "Win Rate by Day of Week", height=380)
    return fig.to_html(full_html=False, include_plotlyjs=False)


def _monthly_heatmap(key: str, trades: pd.DataFrame) -> str:
    if trades.empty:
        return "<p>No data</p>"
    mb = an.monthly_breakdown(trades)
    years = sorted(mb["year"].unique())
    z = []
    for yr in years:
        row = []
        for mo in range(1, 13):
            sub = mb[(mb["year"] == yr) & (mb["month"] == mo)]
            row.append(round(sub["win_rate"].values[0] * 100, 1) if len(sub) else np.nan)
        z.append(row)

    z = np.array(z, dtype=float)
    text = [[f"{v:.0f}%" if not np.isnan(v) else "" for v in row] for row in z]

    fig = go.Figure(go.Heatmap(
        z=z, x=MONTH_ORDER, y=[str(y) for y in years],
        text=text, texttemplate="%{text}",
        colorscale=[[0, RED], [0.5, "#444"], [1, GREEN]],
        zmid=50, zmin=35, zmax=65,
        colorbar=dict(title="Win %", tickfont=dict(color=TEXT)),
    ))
    _layout(fig, f"{STRATEGY_NAMES.get(key, key)} — Monthly Win Rate Heatmap", height=max(280, 60 * len(years)))
    return fig.to_html(full_html=False, include_plotlyjs=False)


def _regime_chart(all_trades: dict[str, pd.DataFrame]) -> str:
    strats = list(all_trades.keys())
    regimes = ["Low Vol", "Med Vol", "High Vol", "Uptrend", "Downtrend", "Near Halving", "Post Halving", "Pre Halving"]
    fig = make_subplots(rows=1, cols=3,
                        subplot_titles=["Volatility Regime", "Trend Regime", "Halving Phase"],
                        shared_yaxes=True)

    for i, (key, trades) in enumerate(all_trades.items()):
        if trades.empty:
            continue
        col_color = COLORS[i % len(COLORS)]
        name = STRATEGY_NAMES.get(key, key)

        # Vol regime
        vb = an.vol_regime_breakdown(trades)
        if not vb.empty:
            fig.add_trace(go.Bar(x=vb["vol_regime"], y=vb["win_rate"]*100, name=name,
                                 marker_color=col_color, showlegend=(i == 0),
                                 legendgroup=key), row=1, col=1)

        # Trend regime
        tb = an.trend_regime_breakdown(trades)
        if not tb.empty:
            fig.add_trace(go.Bar(x=tb["trend_regime"], y=tb["win_rate"]*100, name=name,
                                 marker_color=col_color, showlegend=False,
                                 legendgroup=key), row=1, col=2)

        # Halving
        hb = an.halving_breakdown(trades)
        if not hb.empty:
            fig.add_trace(go.Bar(x=hb["halving_phase"], y=hb["win_rate"]*100, name=name,
                                 marker_color=col_color, showlegend=False,
                                 legendgroup=key), row=1, col=3)

    fig.add_hline(y=50, line_dash="dash", line_color=GRID)
    _layout(fig, "Win Rate by Market Regime (%)", height=400)
    fig.update_layout(barmode="group")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def _trade_distribution(all_trades: dict[str, pd.DataFrame]) -> str:
    fig = go.Figure()
    for i, (key, trades) in enumerate(all_trades.items()):
        if trades.empty:
            continue
        fig.add_trace(go.Histogram(
            x=trades["directed_pct"] * 100,
            name=STRATEGY_NAMES.get(key, key),
            marker_color=COLORS[i % len(COLORS)],
            opacity=0.7,
            nbinsx=60,
        ))
    fig.add_vline(x=0, line_color="white", line_width=1)
    fig.update_xaxes(title="Directed Return per Trade (%)")
    fig.update_yaxes(title="Count")
    _layout(fig, "Trade Return Distribution", height=380)
    return fig.to_html(full_html=False, include_plotlyjs=False)


# ─────────────────────────── summary table ───────────────────────────────────

def _metrics_table(all_metrics: list[dict]) -> str:
    rows_html = ""
    for m in all_metrics:
        if m.get("trades", 0) == 0:
            continue
        wr = m["win_rate"] * 100
        wr_color = GREEN if wr > 52 else (RED if wr < 48 else TEXT)
        pf = m["profit_factor"]
        pf_str = f"{pf:.2f}" if pf < 999 else "∞"
        rows_html += f"""
        <tr>
          <td><span class="badge">{m['name']}</span></td>
          <td>{m['trades']:,}</td>
          <td style="color:{wr_color};font-weight:bold">{wr:.1f}%</td>
          <td>{m['avg_win_pct']:.4f}%</td>
          <td style="color:{RED}">{m['avg_loss_pct']:.4f}%</td>
          <td>{pf_str}</td>
          <td>{m['sharpe']:.2f}</td>
          <td style="color:{RED}">${m['max_dd_usd']:,.0f}</td>
          <td>{m['trades_per_day']:.1f}</td>
          <td style="color:{'#3fb950' if m['equity_final'] > 0 else '#f85149'}">${m['equity_final']:,.0f}</td>
        </tr>"""
    return f"""
    <div class="section">
      <h2>Strategy Summary</h2>
      <div class="table-wrap">
        <table class="metrics-table">
          <thead><tr>
            <th>Strategy</th><th>Trades</th><th>Win Rate</th>
            <th>Avg Win</th><th>Avg Loss</th><th>Profit Factor</th>
            <th>Sharpe</th><th>Max DD</th><th>Trades/Day</th><th>Net P&L</th>
          </tr></thead>
          <tbody>{rows_html}</tbody>
        </table>
      </div>
    </div>"""


# ─────────────────────────── main entry point ────────────────────────────────

def generate(
    all_trades: dict[str, pd.DataFrame],
    all_metrics: list[dict],
    df15: pd.DataFrame,
    output_path: str = "btc_backtest_report.html",
):
    print("Generating HTML report...")

    # Attach regime tags
    tagged = {}
    for key, trades in all_trades.items():
        tagged[key] = an.tag_regimes(trades, df15)

    equity_html      = _equity_chart(tagged)
    dd_html          = _drawdown_chart(tagged)
    session_html     = _session_heatmap(tagged)
    hourly_html      = _hourly_chart(tagged)
    dow_html         = _dow_chart(tagged)
    regime_html      = _regime_chart(tagged)
    dist_html        = _trade_distribution(tagged)
    summary_html     = _metrics_table(all_metrics)

    # Per-strategy monthly heatmaps
    monthly_tabs = ""
    for i, (key, trades) in enumerate(tagged.items()):
        display = "block" if i == 0 else "none"
        monthly_tabs += f'<div class="tab-pane" id="tab-{key}" style="display:{display}">{_monthly_heatmap(key, trades)}</div>'

    tab_buttons = "".join(
        f'<button class="tab-btn" onclick="switchTab(\'{key}\')">{STRATEGY_NAMES.get(key, key)}</button>'
        for key in tagged
    )

    date_range = ""
    for trades in all_trades.values():
        if not trades.empty:
            lo = trades["dt"].min().strftime("%Y-%m-%d")
            hi = trades["dt"].max().strftime("%Y-%m-%d")
            date_range = f"{lo} to {hi} UTC"
            break

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BTC/USD Backtest Report</title>
<script src="https://cdn.plot.ly/plotly-2.26.0.min.js"></script>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background:{BG}; color:{TEXT}; font-family:'Courier New',monospace; font-size:14px; }}
  header {{ background:{CARD}; border-bottom:1px solid {GRID}; padding:20px 32px; }}
  header h1 {{ font-size:22px; color:#fff; }}
  header .sub {{ color:#8b949e; margin-top:4px; }}
  nav {{ background:{CARD}; border-bottom:1px solid {GRID}; padding:0 32px;
         display:flex; gap:0; position:sticky; top:0; z-index:100; }}
  nav a {{ display:block; padding:12px 20px; color:#8b949e; text-decoration:none;
           font-size:13px; border-bottom:2px solid transparent; }}
  nav a:hover, nav a.active {{ color:{TEXT}; border-bottom-color:#00d4ff; }}
  .container {{ max-width:1400px; margin:0 auto; padding:24px 32px; }}
  .section {{ margin-bottom:40px; }}
  .section h2 {{ font-size:16px; color:#fff; margin-bottom:16px;
                padding-bottom:8px; border-bottom:1px solid {GRID}; }}
  .grid-2 {{ display:grid; grid-template-columns:1fr 1fr; gap:24px; }}
  .chart-box {{ background:{CARD}; border:1px solid {GRID}; border-radius:8px;
                padding:16px; overflow:hidden; }}
  .chart-box.full {{ grid-column: 1 / -1; }}
  .table-wrap {{ overflow-x:auto; }}
  .metrics-table {{ width:100%; border-collapse:collapse; font-size:13px; }}
  .metrics-table th {{ background:#1c2128; color:#8b949e; padding:10px 14px;
                       text-align:left; font-weight:normal; white-space:nowrap; }}
  .metrics-table td {{ padding:10px 14px; border-top:1px solid {GRID};
                       white-space:nowrap; }}
  .metrics-table tr:hover td {{ background:#1c2128; }}
  .badge {{ background:#21262d; border:1px solid {GRID}; border-radius:4px;
            padding:2px 8px; font-size:12px; }}
  .tab-buttons {{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }}
  .tab-btn {{ background:#21262d; border:1px solid {GRID}; color:{TEXT};
              padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px;
              font-family:inherit; }}
  .tab-btn:hover {{ background:#30363d; }}
  section {{ padding-top: 20px; }}
</style>
</head>
<body>
<header>
  <h1>BTC/USD — Polymarket Strategy Backtest</h1>
  <div class="sub">Asset: BTC/USD · Bitstamp · 3-min candles → 15-min windows · {date_range}</div>
</header>
<nav>
  <a href="#summary" class="active">Summary</a>
  <a href="#equity">Equity</a>
  <a href="#sessions">Sessions</a>
  <a href="#time">Time</a>
  <a href="#regimes">Regimes</a>
  <a href="#monthly">Monthly</a>
  <a href="#distribution">Distribution</a>
</nav>
<div class="container">

  <section id="summary">
    {summary_html}
  </section>

  <section id="equity">
    <div class="section">
      <h2>Equity &amp; Drawdown</h2>
      <div class="grid-2">
        <div class="chart-box full">{equity_html}</div>
        <div class="chart-box full">{dd_html}</div>
      </div>
    </div>
  </section>

  <section id="sessions">
    <div class="section">
      <h2>Session Analysis</h2>
      <div class="chart-box full">{session_html}</div>
    </div>
  </section>

  <section id="time">
    <div class="section">
      <h2>Time Analysis</h2>
      <div class="grid-2">
        <div class="chart-box full">{hourly_html}</div>
        <div class="chart-box full">{dow_html}</div>
      </div>
    </div>
  </section>

  <section id="regimes">
    <div class="section">
      <h2>Market Regime Analysis</h2>
      <div class="chart-box full">{regime_html}</div>
    </div>
  </section>

  <section id="monthly">
    <div class="section">
      <h2>Monthly Win Rate Heatmaps</h2>
      <div class="tab-buttons">{tab_buttons}</div>
      {monthly_tabs}
    </div>
  </section>

  <section id="distribution">
    <div class="section">
      <h2>Trade Return Distribution</h2>
      <div class="chart-box full">{dist_html}</div>
    </div>
  </section>

</div>
<script>
function switchTab(key) {{
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display='none');
  var pane = document.getElementById('tab-' + key);
  if (pane) pane.style.display = 'block';
}}
// Nav highlight on scroll
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('nav a');
window.addEventListener('scroll', () => {{
  let current = '';
  sections.forEach(sec => {{
    if (window.scrollY >= sec.offsetTop - 80) current = sec.id;
  }});
  navLinks.forEach(a => {{
    a.classList.toggle('active', a.getAttribute('href') === '#' + current);
  }});
}});
</script>
</body>
</html>"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"  Report saved: {output_path}")
    return output_path
