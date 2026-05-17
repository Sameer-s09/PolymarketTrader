"""
Edge Finder — drill into session / hour / day-of-week breakdowns.

For every (strategy × dimension × bucket) slice it runs a one-sided
binomial test vs p=0.50 and flags slices that are:
  • statistically significant at α=0.05 (after Bonferroni correction)
  • have at least MIN_TRADES observations

Outputs an HTML report: edge_finder_report.html
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import pandas as pd
from scipy import stats
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.express as px

import data_fetcher, strategies, report as rpt

# ── config ────────────────────────────────────────────────────────────────────
MIN_TRADES  = 50      # minimum trades to report a slice
ALPHA       = 0.05    # significance level (before Bonferroni)
OUTPUT_HTML = os.path.join(os.path.dirname(__file__), "edge_finder_report.html")

BG   = "#0d1117"
CARD = "#161b22"
TEXT = "#e6edf3"
GRID = "#30363d"
GREEN = "#3fb950"
RED   = "#f85149"
AMBER = "#e3b341"

SESSIONS  = ["ASIA", "LONDON", "OVERLAP", "NY", "LATE_NY"]
DAYS      = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

# ── helpers ───────────────────────────────────────────────────────────────────

def binom_p(wins: int, n: int) -> float:
    """Two-sided p-value: is this win rate different from 50%?"""
    if n == 0:
        return 1.0
    return float(stats.binomtest(wins, n, 0.5, alternative="two-sided").pvalue)


def edge_pct(wr: float) -> float:
    """Distance from 50% — positive means 'bet as-is', negative means 'fade'."""
    return (wr - 0.5) * 100


def slice_df(trades: pd.DataFrame, col: str) -> pd.DataFrame:
    g = (trades.groupby(col)
               .agg(n=("win","count"), wins=("win","sum"))
               .reset_index())
    g["win_rate"] = g["wins"] / g["n"]
    g["edge_pct"] = g["win_rate"].map(edge_pct)
    g["p_value"]  = g.apply(lambda r: binom_p(int(r.wins), int(r.n)), axis=1)
    # Bonferroni correction for number of buckets tested
    n_tests = len(g)
    g["p_bonf"]   = (g["p_value"] * n_tests).clip(upper=1.0)
    g["sig"]      = g["p_bonf"] < ALPHA
    g["direction"] = g["win_rate"].map(lambda w: "FADE" if w < 0.50 else "FOLLOW")
    return g


def add_cross_slice(trades: pd.DataFrame, col1: str, col2: str) -> pd.DataFrame:
    g = (trades.groupby([col1, col2])
               .agg(n=("win","count"), wins=("win","sum"))
               .reset_index())
    g["win_rate"] = g["wins"] / g["n"]
    g["edge_pct"] = g["win_rate"].map(edge_pct)
    g["p_value"]  = g.apply(lambda r: binom_p(int(r.wins), int(r.n)), axis=1)
    n_tests = len(g)
    g["p_bonf"]   = (g["p_value"] * n_tests).clip(upper=1.0)
    g["sig"]      = g["p_bonf"] < ALPHA
    g["direction"] = g["win_rate"].map(lambda w: "FADE" if w < 0.50 else "FOLLOW")
    return g


# ── chart builders ────────────────────────────────────────────────────────────

def _base_layout(fig, title="", height=400):
    fig.update_layout(
        title=dict(text=title, font=dict(color=TEXT, size=15)),
        paper_bgcolor=CARD, plot_bgcolor=BG,
        font=dict(color=TEXT, family="monospace"),
        height=height,
        margin=dict(l=60, r=20, t=50, b=60),
        legend=dict(bgcolor="rgba(0,0,0,0)"),
        xaxis=dict(gridcolor=GRID, zerolinecolor=GRID),
        yaxis=dict(gridcolor=GRID, zerolinecolor=GRID),
    )
    return fig


def heatmap_2d(matrix_df: pd.DataFrame, row_col: str, col_col: str,
               row_order: list, col_order: list, title: str,
               strat_name: str) -> str:
    """Win-rate heatmap with significance stars."""
    z, text = [], []
    for r in row_order:
        zrow, trow = [], []
        for c in col_order:
            sub = matrix_df[(matrix_df[row_col] == r) & (matrix_df[col_col] == c)]
            if len(sub) == 0 or sub["n"].values[0] < MIN_TRADES:
                zrow.append(np.nan); trow.append("")
            else:
                wr = sub["win_rate"].values[0]
                sig = sub["sig"].values[0]
                star = "*" if sig else ""
                trow.append(f"{wr*100:.0f}%{star}")
                zrow.append(wr * 100)
        z.append(zrow); text.append(trow)

    fig = go.Figure(go.Heatmap(
        z=z, x=col_order, y=row_order,
        text=text, texttemplate="%{text}",
        colorscale=[[0, RED], [0.5, "#2d3748"], [1, GREEN]],
        zmid=50, zmin=38, zmax=62,
        colorbar=dict(title="Win %", tickfont=dict(color=TEXT)),
    ))
    _base_layout(fig, f"{strat_name}  |  {title}  (* = p<0.05 Bonferroni)", height=max(280, 42 * len(row_order) + 100))
    return fig.to_html(full_html=False, include_plotlyjs=False)


def hourly_line(all_slices: dict, dimension: str) -> str:
    """One line per strategy showing win-rate by hour."""
    hours = list(range(24))
    COLORS = ["#00d4ff","#ff6b35","#7bc67e","#ffd166","#c77dff"]
    fig = go.Figure()
    for i, (key, sdf) in enumerate(all_slices.items()):
        sdf2 = sdf.set_index(dimension).reindex(hours)
        wr   = sdf2["win_rate"].values * 100
        sig  = sdf2["sig"].fillna(False).values
        # Main line
        fig.add_trace(go.Scatter(
            x=hours, y=wr,
            name=rpt.STRATEGY_NAMES.get(key, key),
            line=dict(color=COLORS[i % len(COLORS)], width=1.8),
            mode="lines",
        ))
        # Significant markers
        xs = [h for h, s in zip(hours, sig) if s]
        ys = [w for w, s in zip(wr, sig) if s]
        if xs:
            fig.add_trace(go.Scatter(
                x=xs, y=ys, mode="markers",
                marker=dict(color=COLORS[i % len(COLORS)], size=9,
                            symbol="circle", line=dict(width=2, color="white")),
                showlegend=False,
                hoverinfo="skip",
            ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID, annotation_text="50%")
    fig.add_hrect(y0=52, y1=65, fillcolor=GREEN, opacity=0.04, line_width=0)
    fig.add_hrect(y0=35, y1=48, fillcolor=RED,   opacity=0.04, line_width=0)
    fig.update_xaxes(tickmode="linear", dtick=1, title="Hour (UTC)")
    fig.update_yaxes(title="Win Rate (%)", range=[35, 65])
    _base_layout(fig, "Win Rate by Hour of Day (UTC)  |  circled = statistically significant", height=420)
    return fig.to_html(full_html=False, include_plotlyjs=False)


def session_bar(all_slices: dict) -> str:
    COLORS = ["#00d4ff","#ff6b35","#7bc67e","#ffd166","#c77dff"]
    fig = go.Figure()
    for i, (key, sdf) in enumerate(all_slices.items()):
        sdf2 = sdf.set_index("session").reindex(SESSIONS).reset_index()
        wr = sdf2["win_rate"].fillna(0.5).values * 100
        sig = sdf2["sig"].fillna(False).values
        labels = [f"{s}{' *' if s else ''}" for s, sig_flag in zip(SESSIONS, sig) if True]
        labels = [f"{s}{'*' if f else ''}" for s, f in zip(SESSIONS, sig)]
        fig.add_trace(go.Bar(
            x=SESSIONS, y=wr,
            name=rpt.STRATEGY_NAMES.get(key, key),
            marker_color=COLORS[i % len(COLORS)],
            opacity=0.85,
        ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID)
    fig.update_yaxes(title="Win Rate (%)", range=[35, 65])
    _base_layout(fig, "Win Rate by Session  (* = significant after Bonferroni)", height=380)
    fig.update_layout(barmode="group")
    return fig.to_html(full_html=False, include_plotlyjs=False)


def dow_bar(all_slices: dict) -> str:
    COLORS = ["#00d4ff","#ff6b35","#7bc67e","#ffd166","#c77dff"]
    fig = go.Figure()
    for i, (key, sdf) in enumerate(all_slices.items()):
        sdf2 = sdf.set_index("day_of_week").reindex(range(7)).reset_index()
        wr  = sdf2["win_rate"].fillna(0.5).values * 100
        sig = sdf2["sig"].fillna(False).values
        fig.add_trace(go.Bar(
            x=[f"{d}{'*' if s else ''}" for d, s in zip(DAYS, sig)],
            y=wr,
            name=rpt.STRATEGY_NAMES.get(key, key),
            marker_color=COLORS[i % len(COLORS)],
            opacity=0.85,
        ))
    fig.add_hline(y=50, line_dash="dash", line_color=GRID)
    fig.update_yaxes(title="Win Rate (%)", range=[35, 65])
    _base_layout(fig, "Win Rate by Day of Week", height=380)
    fig.update_layout(barmode="group")
    return fig.to_html(full_html=False, include_plotlyjs=False)


# ── ranked opportunities table ────────────────────────────────────────────────

def build_opportunities(all_trades: dict) -> pd.DataFrame:
    rows = []
    dimensions = [
        ("session",     "Session"),
        ("hour",        "Hour (UTC)"),
        ("day_of_week", "Day"),
    ]
    for key, trades in all_trades.items():
        sname = rpt.STRATEGY_NAMES.get(key, key)
        for col, dim_label in dimensions:
            sdf = slice_df(trades, col)
            for _, row in sdf.iterrows():
                if row["n"] < MIN_TRADES:
                    continue
                bucket = row[col]
                if col == "day_of_week":
                    bucket = DAYS[int(bucket)]
                elif col == "month":
                    bucket = MONTHS[int(bucket) - 1]
                rows.append({
                    "Strategy":  sname,
                    "Dimension": dim_label,
                    "Bucket":    str(bucket),
                    "Trades":    int(row["n"]),
                    "Win Rate":  row["win_rate"],
                    "Edge":      row["edge_pct"],
                    "Direction": row["direction"],
                    "p-value":   row["p_bonf"],
                    "Sig":       row["sig"],
                })
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df.sort_values("p-value")
    return df


def opportunities_html(df: pd.DataFrame) -> str:
    if df.empty:
        return "<p>No significant slices found.</p>"

    sig_df   = df[df["Sig"]].head(50)
    insig_df = df[~df["Sig"]].head(30)

    def row_html(r, highlight: bool) -> str:
        wr = r["Win Rate"] * 100
        edge = r["Edge"]
        wr_color = GREEN if wr > 52 else (RED if wr < 48 else TEXT)
        dir_color = AMBER if r["Direction"] == "FADE" else GREEN
        bg = "background:#1a2332;" if highlight else ""
        pval = r["p-value"]
        pval_str = f"{pval:.4f}" if pval >= 0.0001 else "<0.0001"
        star = "YES" if r["Sig"] else ""
        return (
            f'<tr style="{bg}">'
            f'<td><span class="badge">{r["Strategy"]}</span></td>'
            f'<td>{r["Dimension"]}</td>'
            f'<td><b>{r["Bucket"]}</b></td>'
            f'<td>{r["Trades"]:,}</td>'
            f'<td style="color:{wr_color};font-weight:bold">{wr:.1f}%</td>'
            f'<td style="color:{wr_color}">{edge:+.1f}%</td>'
            f'<td style="color:{dir_color}">{r["Direction"]}</td>'
            f'<td>{pval_str}</td>'
            f'<td style="color:{GREEN}">{star}</td>'
            f'</tr>'
        )

    sig_rows   = "".join(row_html(r, True)  for _, r in sig_df.iterrows())
    insig_rows = "".join(row_html(r, False) for _, r in insig_df.iterrows())

    return f"""
<h3 style="color:{GREEN};margin:16px 0 8px">Statistically Significant Slices (p &lt; {ALPHA} after Bonferroni)</h3>
<div class="table-wrap">
<table class="metrics-table">
  <thead><tr>
    <th>Strategy</th><th>Dimension</th><th>Bucket</th><th>Trades</th>
    <th>Win Rate</th><th>Edge</th><th>Direction</th><th>p-value (Bonf.)</th><th>Sig</th>
  </tr></thead>
  <tbody>{sig_rows}</tbody>
</table>
</div>
<h3 style="color:{AMBER};margin:24px 0 8px">Notable Non-Significant Slices (top by edge)</h3>
<div class="table-wrap">
<table class="metrics-table">
  <thead><tr>
    <th>Strategy</th><th>Dimension</th><th>Bucket</th><th>Trades</th>
    <th>Win Rate</th><th>Edge</th><th>Direction</th><th>p-value (Bonf.)</th><th>Sig</th>
  </tr></thead>
  <tbody>{insig_rows}</tbody>
</table>
</div>"""


# ── cross heatmaps (session × hour) ──────────────────────────────────────────

def cross_heatmaps_html(all_trades: dict) -> str:
    hour_bins = list(range(24))
    parts = []
    for key, trades in all_trades.items():
        sname = rpt.STRATEGY_NAMES.get(key, key)
        cross = add_cross_slice(trades, "session", "hour")
        html = heatmap_2d(cross, "session", "hour",
                          SESSIONS, hour_bins,
                          "Session x Hour Win Rate", sname)
        parts.append(f'<div class="chart-box" style="margin-bottom:24px">{html}</div>')
    return "\n".join(parts)


def dow_session_html(all_trades: dict) -> str:
    parts = []
    for key, trades in all_trades.items():
        sname = rpt.STRATEGY_NAMES.get(key, key)
        cross = add_cross_slice(trades, "day_of_week", "session")
        cross["day_of_week"] = cross["day_of_week"].map(lambda x: DAYS[int(x)])
        html = heatmap_2d(cross, "day_of_week", "session",
                          DAYS, SESSIONS,
                          "Day-of-Week x Session Win Rate", sname)
        parts.append(f'<div class="chart-box" style="margin-bottom:24px">{html}</div>')
    return "\n".join(parts)


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    # 1. Load data (cached)
    df3 = data_fetcher.load_data(years=5)

    # 2. Run strategies
    all_trades = strategies.run_all(df3)

    # 3. Per-dimension slices
    print("Computing breakdowns...")
    session_slices = {k: slice_df(t, "session")     for k, t in all_trades.items()}
    hour_slices    = {k: slice_df(t, "hour")         for k, t in all_trades.items()}
    dow_slices     = {k: slice_df(t, "day_of_week")  for k, t in all_trades.items()}

    # 4. Build charts
    print("Building charts...")
    hourly_html    = hourly_line(hour_slices, "hour")
    sess_html      = session_bar(session_slices)
    dow_html       = dow_bar(dow_slices)
    cross_sess_hr  = cross_heatmaps_html(all_trades)
    cross_dow_sess = dow_session_html(all_trades)
    opps_df        = build_opportunities(all_trades)
    opps_html      = opportunities_html(opps_df)

    # 5. Print top findings to console
    print()
    sig = opps_df[opps_df["Sig"]].head(20)
    if not sig.empty:
        print(f"TOP SIGNIFICANT SLICES (p<{ALPHA} Bonferroni-corrected):")
        print(f"{'Strategy':<28} {'Dim':<12} {'Bucket':<10} {'N':>6} {'WinRate':>8} {'Edge':>7} {'Dir':<7}")
        print("-" * 85)
        for _, r in sig.iterrows():
            print(f"{r['Strategy']:<28} {r['Dimension']:<12} {str(r['Bucket']):<10} "
                  f"{r['Trades']:>6,} {r['Win Rate']*100:>7.1f}% {r['Edge']:>+6.1f}% {r['Direction']:<7}")
    else:
        print("No slices survived Bonferroni correction at this threshold.")
        near = opps_df.head(20)
        print("\nNearest misses (uncorrected p < 0.05):")
        near_sig = opps_df[opps_df["p-value"] < ALPHA].head(20)
        for _, r in near_sig.iterrows():
            print(f"  {r['Strategy']:<28} {r['Dimension']:<12} {str(r['Bucket']):<10} "
                  f"{r['Trades']:>6,} {r['Win Rate']*100:>6.1f}%  p={r['p-value']:.4f}")

    # 6. Generate HTML
    print("\nGenerating edge_finder_report.html...")
    _write_report(hourly_html, sess_html, dow_html,
                  cross_sess_hr, cross_dow_sess, opps_html)
    print(f"  Saved: {OUTPUT_HTML}")


def _write_report(hourly_html, sess_html, dow_html,
                  cross_sess_hr, cross_dow_sess, opps_html):
    css = f"""
    *, *::before, *::after {{ box-sizing:border-box; margin:0; padding:0; }}
    body {{ background:{BG}; color:{TEXT}; font-family:'Courier New',monospace; font-size:14px; }}
    header {{ background:{CARD}; border-bottom:1px solid {GRID}; padding:20px 32px; }}
    header h1 {{ font-size:22px; color:#fff; }}
    header .sub {{ color:#8b949e; margin-top:4px; font-size:13px; }}
    nav {{ background:{CARD}; border-bottom:1px solid {GRID}; padding:0 32px;
           display:flex; gap:0; position:sticky; top:0; z-index:100; }}
    nav a {{ display:block; padding:12px 18px; color:#8b949e; text-decoration:none;
             font-size:13px; border-bottom:2px solid transparent; }}
    nav a:hover {{ color:{TEXT}; border-bottom-color:#00d4ff; }}
    .container {{ max-width:1400px; margin:0 auto; padding:24px 32px; }}
    .section {{ margin-bottom:40px; }}
    .section h2 {{ font-size:16px; color:#fff; margin-bottom:16px;
                  padding-bottom:8px; border-bottom:1px solid {GRID}; }}
    h3 {{ font-size:14px; }}
    .chart-box {{ background:{CARD}; border:1px solid {GRID}; border-radius:8px;
                  padding:16px; overflow:hidden; margin-bottom:16px; }}
    .table-wrap {{ overflow-x:auto; margin-bottom:24px; }}
    .metrics-table {{ width:100%; border-collapse:collapse; font-size:12.5px; }}
    .metrics-table th {{ background:#1c2128; color:#8b949e; padding:9px 12px;
                         text-align:left; font-weight:normal; white-space:nowrap; }}
    .metrics-table td {{ padding:9px 12px; border-top:1px solid {GRID}; white-space:nowrap; }}
    .metrics-table tr:hover td {{ background:#1c2128; }}
    .badge {{ background:#21262d; border:1px solid {GRID}; border-radius:4px;
              padding:2px 6px; font-size:11px; }}
    .note {{ background:#1c2128; border-left:3px solid {AMBER}; padding:12px 16px;
             margin-bottom:20px; font-size:13px; border-radius:0 4px 4px 0; }}
    """

    note = f"""
    <div class="note">
      <b>How to read this report:</b> Each slice shows the win rate of a strategy
      in a specific time bucket. Win rate &gt;50% means the strategy as-is has edge in
      that window. Win rate &lt;50% means the <b>fade</b> (opposite direction) has edge.
      Stars (*) indicate statistical significance at &alpha;={ALPHA} after
      Bonferroni correction for multiple comparisons.
      Minimum {MIN_TRADES} trades required per bucket.
    </div>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BTC Backtest — Edge Finder</title>
<script src="https://cdn.plot.ly/plotly-2.26.0.min.js"></script>
<style>{css}</style>
</head>
<body>
<header>
  <h1>BTC/USD — Edge Finder Report</h1>
  <div class="sub">5-year backtest (Binance BTCUSDT, 3-min candles) &nbsp;|&nbsp;
    Binomial test vs p=0.50, Bonferroni-corrected &nbsp;|&nbsp; min {MIN_TRADES} trades per bucket
  </div>
</header>
<nav>
  <a href="#opps">Ranked Opportunities</a>
  <a href="#hourly">Hourly</a>
  <a href="#session">Session</a>
  <a href="#dow">Day of Week</a>
  <a href="#cross_sh">Session x Hour</a>
  <a href="#cross_ds">DoW x Session</a>
</nav>
<div class="container">

  <section id="opps">
    <div class="section">
      <h2>Ranked Edge Opportunities</h2>
      {note}
      {opps_html}
    </div>
  </section>

  <section id="hourly">
    <div class="section">
      <h2>Win Rate by Hour of Day (UTC)</h2>
      <div class="chart-box">{hourly_html}</div>
    </div>
  </section>

  <section id="session">
    <div class="section">
      <h2>Win Rate by Session</h2>
      <div class="chart-box">{sess_html}</div>
    </div>
  </section>

  <section id="dow">
    <div class="section">
      <h2>Win Rate by Day of Week</h2>
      <div class="chart-box">{dow_html}</div>
    </div>
  </section>

  <section id="cross_sh">
    <div class="section">
      <h2>Session x Hour Heatmaps (per strategy)</h2>
      {cross_sess_hr}
    </div>
  </section>

  <section id="cross_ds">
    <div class="section">
      <h2>Day-of-Week x Session Heatmaps (per strategy)</h2>
      {cross_dow_sess}
    </div>
  </section>

</div>
</body>
</html>"""

    with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    main()
