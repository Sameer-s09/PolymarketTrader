# Polymarket Strategies — Genuine Edge Research

Compiled from: Reddit, academic papers (SSRN, arXiv), Medium, QuantPedia, forums, and trading communities.  
Excludes all arbitrage strategies where edge depends on execution speed.  
Focus: structural biases, behavioural inefficiencies, and information edges that retail traders can exploit.

---

## Reality Check First

- Only **7.6% of Polymarket wallets** are profitable (Dune Analytics)
- The top **3% of traders** account for most price discovery and consistently win against the other 97%
- **73% of all Polymarket outcomes resolve as NO** — markets are structurally biased toward YES
- Most retail losses come from paying the spread, fighting the bias, and sizing wrong — not from bad calls

---

## Strategy 1 — YES / Default Bias on New Markets

**Edge source:** UI anchoring + status quo bias  
**Type:** Structural, repeatable  
**Effort:** Low — scan for freshly created markets  

### The Bias

Academic paper by Reichenbach & Walther (2025) analyzed 124 million Polymarket trades and found:

- Polymarket shows YES in **green**, NO in **red**
- The price chart only shows the probability of the default (YES) outcome
- This asymmetric framing causes retail traders to systematically **overtrade YES** especially in the first hours after a market is created
- The bias is strongest in the first 1–4 hours of a new market's life and near resolution

### The Trade

When a new market opens:
1. Check if the question is framed as something unlikely to actually happen (e.g. "Will X happen by date Y?")
2. If YES is priced above what base rates suggest, **buy NO**
3. Hold until price corrects or near resolution

### Expected Edge

- YES is reliably overpriced on new markets before the crowd arrives
- Especially strong on speculative/hype-driven markets (celebrity events, unlikely political outcomes)
- Research shows >40% of new market conditions start mispriced

### Risk

- Markets where the event actually happens leave you with a losing NO position
- Works best on clearly speculative questions, not ambiguous ones

---

## Strategy 2 — Favorite-Longshot Bias (Sell Longshots, Buy Favorites)

**Edge source:** Behavioural — humans overweight small probabilities  
**Type:** Structural, well-documented academically  
**Effort:** Medium — requires screening and patience  

### The Bias

Decades of academic research across sports betting, Kalshi, PredictIt, and Polymarket show:

- Contracts priced **5¢–20¢ (5%–20% probability)** consistently lose more than their price implies
  - Kalshi data: contracts under 10¢ lose **over 60%** of invested capital on average
- Contracts priced **80¢–95¢** consistently win more often than implied
  - Statistically significant positive returns averaging **+2.6% before fees** on Kalshi
- Root cause: humans apply psychological probability weighting (Kahneman & Tversky) — they overvalue lottery-ticket outcomes

### The Trade

**Sell longshots:**
- Find markets where YES is priced 5–20¢ on an event you believe is truly unlikely (not just cheap)
- Sell YES (= buy NO) using limit orders as maker (avoid spread cost)
- Let time decay and probability work for you

**Buy heavy favorites:**
- Find markets where YES is 85–96¢ and resolution is imminent
- The underpricing is structural — boring high-probability events attract less excitement

### Practical Filter

Only trade markets you understand the domain for. The bias is real but requires you to correctly identify whether the "longshot" is actually overpriced vs. correctly cheap.

### Risk

- Selling a 10¢ longshot means you collect 10¢ but lose 90¢ when it hits
- Requires proper sizing (max 2–5% of bankroll per trade)
- Transaction costs eat into edge on cheap contracts — use limit orders only

---

## Strategy 3 — Recency Bias / News Overreaction Fade

**Edge source:** Behavioural — markets overshoot on breaking news  
**Type:** Tactical, event-driven  
**Effort:** Medium — requires news monitoring and timing discipline  

### The Pattern

Research shows prediction markets systematically overreact to breaking news in the first **30–90 minutes**:

- A negative headline causes YES to drop further than the information justifies
- A positive headline pumps YES above rational probability
- The overreaction then mean-reverts as more informed traders re-anchor the price

This mirrors the "earnings reaction fade" in equities but with faster cycles.

### The Trade

1. Set alerts for major news in your domain (politics, crypto, sports)
2. Watch Polymarket prices when news breaks
3. **Wait 30–60 minutes** — let the initial panic/euphoria set prices
4. Identify if the move has overshot (compare to base rates and comparable past events)
5. Take the contrarian position: fade the overreaction
6. Target exit when price returns to pre-news level or rational midpoint

### Example Pattern

- Major FUD article about a political candidate → YES on their winning drops from 65¢ to 45¢
- Base rate says one article rarely shifts outcome probability by 20 points
- Buy YES at 45¢, exit at 58¢ as market digests

### Risk

- Sometimes news is genuinely material and the move is correct
- Requires judgment to distinguish overreaction from real information
- Best used in markets where you already have domain knowledge

---

## Strategy 4 — Near-Resolution Value Grinding

**Edge source:** Illiquidity premium + systematic underprice of near-certain outcomes  
**Type:** Capital-intensive, reliable, boring  
**Effort:** Low effort per trade, high capital required  

### The Setup

In the final **12–48 hours** before a near-certain outcome resolves:

- YES may trade at 95¢–98¢ despite near-certainty
- This 2–5% gap represents annualized returns of **700%–1800%**
- The discount exists because traders demand compensation for the wait and resolution risk

### The Trade

1. Find markets where the outcome is essentially decided but not yet formally resolved
   - Election results announced but market not closed
   - Court ruling issued but market awaiting UMA oracle confirmation
   - Sports result known but settlement pending
2. Buy YES at 95¢–99¢
3. Collect $1.00 at resolution
4. Repeat with same capital the next day

### Real Numbers

Documented wallets (Sharky6999, LlamaEnjoyer) generate **$150k+ weekly** doing this at scale.  
1–5% per trade × fast resolution cycle × large capital = significant income stream.

### Risk

- Resolution disputes can freeze capital for days/weeks (UMA oracle challenge period)
- Counterparty / smart contract risk
- Requires large capital to generate meaningful dollar returns on 1–5% trades

---

## Strategy 5 — Correlated Market Logic Inconsistencies

**Edge source:** Math — markets price related events inconsistently  
**Type:** Structural, no speed required  
**Effort:** High — requires active scanning across markets  

### The Inefficiency

Polymarket runs hundreds of markets simultaneously. Sometimes related markets are priced in ways that are **mathematically impossible**:

- "Chiefs win Super Bowl" = 28¢ — but "Any AFC team wins Super Bowl" = 24¢  
  (Impossible: Chiefs are AFC, so AFC probability ≥ Chiefs probability)
- "Biden wins" = 40¢, "Democrat wins" = 35¢  
  (Impossible: Biden probability ≤ Democrat probability)
- Sum of all outcomes in a multi-outcome market < $1.00 or > $1.00

### The Trade

When you find a logical inconsistency:
- Buy the underpriced leg and hold until resolution or until the market corrects
- No need for speed — these mispricings can persist for hours or days in thin markets
- Profit is mathematically certain if you can hold to resolution

### Tools

- Scan markets manually or build a script to check sum-of-all-outcomes on multi-outcome markets
- Compare related markets (same event, different framing) for logical violations
- Polymarket's NBA arbitrage paper (arXiv 2025) shows this is a real and persistent phenomenon in sports markets

### Risk

- Thin liquidity — you may not get the size you want at the mispriced level
- Resolution disputes can invalidate positions
- Requires careful reading of resolution criteria — markets can look logically connected but resolve differently

---

## Strategy 6 — Structural NO Bias (Systematic Short of Hype Markets)

**Edge source:** Market structure — 73% of outcomes resolve NO  
**Type:** Structural, portfolio approach  
**Effort:** Medium — requires selecting the right NO candidates  

### The Structural Reality

Research across Polymarket shows:
- **>73% of all market outcomes resolve as NO**
- The platform and culture create constant YES bias: exciting questions, news-driven framing, social media hype
- Retail traders systematically overpay for YES on speculative, attention-grabbing events

### The Trade

Build a portfolio of NO positions on:
- Celebrity/entertainment events (will X happen by date?)
- Speculative crypto events (will BTC reach $Xk by date?)
- Unlikely political outcomes (will Y happen this year?)
- Any market where the question was created *because* something is being buzzed about (buzz ≠ probability)

Size each position at 2–5% of bankroll, diversify across 20+ markets.  
A 73% base NO rate means even random selection of speculative markets has positive expected value — and you can do better by filtering.

### Risk

- If you pick wrong NO candidates (markets that actually resolve YES), you lose 4–5× your NO stake
- Requires discipline to not pick NOs on events where YES is actually underpriced

---

## Strategy 7 — Domain Expertise / Information Edge

**Edge source:** You know more than the crowd in a specific niche  
**Type:** Skill-based, non-replicable  
**Effort:** High — requires genuine deep domain knowledge  

### The Evidence

The top earners on Polymarket consistently win through **concentrated domain expertise**, not general prediction:

- **"fengdubiying"** — made **$3.2 million** during League of Legends World Championship betting purely on esports knowledge
- Top 5 all-time profit leaders made their money in US politics through hundreds of consistent trades
- Only **3% of traders drive price discovery** — these are people with genuine information edges

### How It Works

Pick one domain where you know more than the general population:
- Your profession (policy, medicine, law, sports coaching, tech)
- Deep hobby (esports, niche sports, specific political systems)
- Network (early access to industry information, expert contacts)

Then exclusively trade markets in that domain. Do not diversify into areas you don't understand.

### Application

- If you're deep in crypto: trade crypto technical/regulatory markets
- If you follow politics in a specific country: trade those election markets
- If you follow a specific sports league: trade outcome markets there

### Risk

- Overconfidence is the main killer — expertise ≠ certainty
- Use Kelly criterion or half-Kelly to size appropriately even when confident

---

## Strategy 8 — Market Making on Illiquid Markets

**Edge source:** Wide bid-ask spreads in thin markets  
**Type:** Structural, passive income  
**Effort:** Medium-High — requires capital, automation for best results  

### The Setup

Polymarket runs on a CLOB (Central Limit Order Book). In illiquid markets:
- Bid-ask spreads can be **8–12%** wide
- "Almost nobody wants to provide liquidity" (direct quote from practitioners)
- Polymarket also pays additional **liquidity rewards** on top of spread capture

### The Trade

Post limit orders on BOTH YES and NO sides of a market simultaneously:
- Example: YES bid at 0.44, YES ask at 0.48 — NO bid at 0.51, NO ask at 0.55
- When both sides fill, you have zero directional exposure and pocket 4–8% spread
- Adjust orders every 30 seconds based on inventory

### Reported Returns

- **1–3% monthly** consistently from spread capture alone (78–85% win rate on individual fills)
- Real documented example: $1,247 profit on $10k capital over 3 weeks from a single Bitcoin market
- Top market makers report **$150–300/day per market** at $100k+ daily volume

### Critical Risk

- Breaking news can move a market **40–50 points** while your orders are live
- If you're quoting YES at 0.52 and the true value jumps to 0.90 instantly, you get filled at 0.52 and immediately lose 38 cents per share
- **Mitigation:** Focus on slow-moving non-crypto markets, set tight stop-loss triggers, widen spreads during high-uncertainty periods

---

## Strategy 9 — Verified Whale Copy Trading (Non-Speed Version)

**Edge source:** Piggybacking on the 3% of traders who drive price discovery  
**Type:** Signal-following  
**Effort:** Low to Medium  

### Why It Can Work

Polymarket is fully on-chain — every wallet's complete trade history is publicly verifiable:
- Win rate over 100+ trades
- P&L by market type
- Position sizing consistency
- Which domains they trade

This is impossible in traditional markets. You can verify a trader's edge before copying.

### The Strategy (Non-Speed Version)

Speed-based copying (sub-47ms bots) is saturated. The non-speed version:

1. **Identify 3–5 wallets** with verified 60%+ win rate over 200+ trades in a specific domain using tools like Polytrack or AlphaWhale
2. Only enter a position when **2–3 of your tracked wallets** move in the same direction on the same market within a short window
3. Entry: place a limit order at a slightly better price than the whale (they moved the market, so price has already ticked)
4. This consensus filter dramatically reduces false signals

### Signal Strength Filter

| Scenario | Action |
|---|---|
| 1 whale buys YES | Watch — insufficient signal |
| 2 whales buy YES independently | Consider entering with 30% normal size |
| 3+ whales agree | Enter full size |
| Whale enters AND price hasn't moved yet | Highest-priority signal |

### Risk

- Whales can be wrong too
- On-chain data can be gamed (wash trading, Sybil wallets)
- Past performance ≠ future results even for top traders

---

## Strategy 10 — AI Consensus Divergence

**Edge source:** LLM probability assessment vs. crowd pricing  
**Type:** Information processing edge  
**Effort:** Medium — requires building a simple pipeline  

### The Setup

Documented to work: run an ensemble of AI models (GPT-4, Claude, etc.) on the raw facts of an event and get a probability estimate. Compare to current market price.

- If AI consensus says 65% and market prices 45% → buy YES
- Only act when divergence is **>15%** (accounting for model error + fees)

Documented real trade: Trump witness recantation case — AI detected a 23% → 41% probability shift **90 seconds before** the market moved from 28%, capturing $896 profit on a $2,000 position.

### How to Build This

```
1. Monitor Polymarket for markets in your target domains
2. When news breaks on a market, feed the raw text to 2-3 LLMs
3. Ask each: "What is the probability of [outcome] given this information?"
4. If LLM consensus diverges from market price by >15%, place limit order
5. Exit when market converges to AI estimate or new information arrives
```

### Realistic Returns

- 65–75% win rate documented in backtests
- 3–8% monthly with moderate capital allocation
- Edge degrades as more traders build similar systems — act before this is mainstream

### Risk

- LLMs can be confidently wrong, especially on ambiguous or highly political questions
- Model hallucinations on factual claims
- This edge will compress as more traders use AI tools

---

## Strategy 11 — The BTC 15-Min Mean Reversion Fade (Our Backtested Strategy)

**Edge source:** BTC price mean-reversion after momentum streaks  
**Type:** Quantitative, fully backtested  
**Effort:** Low — rules are fully defined, can automate  

### Backtest Results (5 Years, 876k candles)

| Strategy | Trades | Win Rate | Sharpe |
|---|---|---|---|
| S4-Fade (4 consecutive candles) | 16,683 | **57.1%** | **7.46** |
| S5-Fade (5 consecutive candles) | 7,153 | **57.6%** | **5.56** |

### Best Windows (from `FADE_STRATEGY_SPEC.md`)

- **Saturday** + 5-candle streak → **63%** win rate
- **LONDON session (08–13 UTC)** → 59–60%
- **Hours 11–12 UTC** → 62%+
- Edge is consistent every year 2021–2026

### See full spec

`FADE_STRATEGY_SPEC.md` in this repository for exact signal logic and automation spec.

---

## Summary Table — Strategies by Effort & Edge Type

| # | Strategy | Edge Source | Effort | Scale |
|---|---|---|---|---|
| 1 | YES/Default Bias on New Markets | UI anchoring, behavioural | Low | Medium |
| 2 | Sell Longshots / Buy Favorites | Favourite-longshot bias | Medium | High |
| 3 | News Overreaction Fade | Recency bias, mean reversion | Medium | Medium |
| 4 | Near-Resolution Value Grinding | Illiquidity premium | Low (needs capital) | High |
| 5 | Correlated Market Logic Gaps | Mathematical impossibility | High (scanning) | Low |
| 6 | Structural NO Portfolio | 73% NO base rate | Medium | High |
| 7 | Domain Expertise | Knowledge edge | High | High |
| 8 | Market Making (Illiquid) | Bid-ask spread + rewards | Medium-High | High |
| 9 | Verified Whale Copy (consensus) | Piggybacking informed 3% | Medium | Medium |
| 10 | AI Consensus Divergence | Information processing speed | Medium | Medium |
| 11 | BTC 15-Min Fade (backtested) | Price mean reversion | Low | Medium |

---

## What to Combine for Maximum Edge

The most profitable retail approach based on research:

**Tier 1 — Do these always:**
- Strategy 2 (sell longshots) as a background portfolio
- Strategy 6 (NO bias) as a background portfolio
- Strategy 4 (near-resolution grinding) whenever capital is idle

**Tier 2 — Do these when the setup appears:**
- Strategy 1 (YES bias on new markets) — scan for new markets daily
- Strategy 3 (fade news overreaction) — set alerts, patience required
- Strategy 11 (BTC 15-min fade) — fully automated, runs itself

**Tier 3 — Build toward these:**
- Strategy 7 (domain expertise) — pick your one domain and go deep
- Strategy 10 (AI divergence) — build the pipeline once, runs passively

---

## Key Risk Management Rules (From Research)

1. **Never bet more than 2–5% of bankroll on a single market** — Polymarket outcomes are binary, variance is extreme
2. **Use limit orders as maker, never market orders as taker** — the bid-ask spread is often 2–10%, taker fees on top
3. **Kelly Criterion for sizing**: Stake = (edge / odds) × bankroll. Use half-Kelly for safety
4. **Track your calibration** — are you winning at the frequency your edge predicts? If not, reduce size
5. **Avoid trading markets right after major news breaks** — first 30–60 min is the most dangerous period (overreaction in both directions)
6. **Resolution risk is real** — always read UMA oracle resolution criteria before entering; ambiguous markets can resolve unexpectedly

---

## Sources

- [Systematic Edges in Prediction Markets — QuantPedia](https://quantpedia.com/systematic-edges-in-prediction-markets/)
- [Exploring Decentralized Prediction Markets: Accuracy, Skill & Bias on Polymarket — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5910522)
- [Prediction Market Biases: How to Exploit for Profit — Laika Labs](https://laikalabs.ai/prediction-markets/prediction-market-biases-how-to-exploit-profit)
- [5 Ways to Make $100K on Polymarket — MONOLITH/Medium](https://medium.com/@monolith.vc/5-ways-to-make-100k-on-polymarket-f6368eed98f5)
- [Beyond Simple Arbitrage: 4 Strategies Bots Profit From — ILLUMINATION/Medium](https://medium.com/illumination/beyond-simple-arbitrage-4-polymarket-strategies-bots-actually-profit-from-in-2026-ddacc92c5b4f)
- [Only 3% of Traders Drive Prediction Markets' Accuracy — CoinDesk](https://www.coindesk.com/markets/2026/04/26/only-3-of-traders-drive-prediction-markets-accuracy-not-the-crowd-study-finds)
- [Unlocking Edges in Polymarket 5-Minute Crypto Markets — Medium](https://medium.com/@benjamin.bigdev/unlocking-edges-in-polymarkets-5-minute-crypto-markets-last-second-dynamics-bot-strategies-and-db8efcb5c196)
- [What Five New Academic Papers Say About Prediction Markets — Next Event Horizon](https://nexteventhorizon.substack.com/p/what-five-new-academic-papers-say-prediction-markets)
- [Polymarket Introduces Dynamic Fees to Curb Latency Arbitrage — Finance Magnates](https://www.financemagnates.com/cryptocurrency/polymarket-introduces-dynamic-fees-to-curb-latency-arbitrage-in-short-term-crypto-markets/)
- [Polymarket Market Making Guide — NYC Servers](https://newyorkcityservers.com/blog/prediction-market-making-guide)
- [Polymarket Winning Strategies Expert Guide — TheBoard.world](https://theboard.world/articles/markets/prediction-market-trading-strategies-expert-edge/)
- [The Favorite-Longshot Bias: NBER Working Paper](https://www.nber.org/system/files/working_papers/w15923/w15923.pdf)
- [Arbitrage Analysis in Polymarket NBA Markets — arXiv](https://arxiv.org/html/2605.00864)
