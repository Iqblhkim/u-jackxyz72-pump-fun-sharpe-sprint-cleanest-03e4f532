# BUILD_NOTES — Steady Scalper (Pump.fun Sharpe Sprint)

Bounty: **Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins**
(`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`, $2 total, top 3 $1 / $0.60 / $0.40;
entries close 2026-11-28T17:00Z). Ranking by **hourly Sharpe** on a 6-hour forward
replay; a place needs net PnL > 0 SOL after fees; guardrails: max 5 open positions,
≥ 20 distinct mints with round trips ≥ 0.01 SOL, max drawdown 50%.

Status: **built + tested locally. NOT submitted. No repo created. No quota spent.**

## Files

- `main.ts` — entrypoint (Node 22, `runBot` shim)
- `strategy.ts` — the strategy (params in `DEFAULT_PARAMS`)
- `vendor/makefun-bot.ts` — kit SDK, byte-identical copy of `sdk/ts/makefun-bot.ts`
- `LICENSE` (MIT), `README.md`
- `tools/` — dev-only tooling, not imported by the bot:
  - `sim.ts` — local port of the kit replay engine (from the sibling Launch Surfer
    entry's tooling) + hourly-Sharpe helpers (`hourlySharpe`, `chunkSharpes`)
  - `sharpe.ts` — full-window sim reporting net, hourly Sharpe (24h + 6h chunks),
    trips, win rate, drawdown, ex-top-3
  - `sweep-sharpe.ts` — grid sweep scored by median 6h-chunk Sharpe
  - `analyse.ts` / `analyse2.ts` — horizon + TP/SL return-distribution analysis
  - `backtest.ts` / `robust.ts` / `screen.ts` / `sweep.ts` — reused sim tooling
- Kit (own download, 25 Nov 2026, HTTP 200): `../u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532-kit/`
  (the bounty kit endpoint served fine — the sibling kit was NOT needed).

## Strategy

Breadth-filtered launch scalps, hold 20 slots, pyramid into strength:

- Buy inside the first 50 slots when the opening tape shows ≥ 7 distinct
  non-creator buyers, net SOL in ≥ 0.3, buys ≥ 60% of trades, price +15–30%
  over the first trade, real SOL ≥ 3, creator bought 0 SOL and never sold,
  no single buyer over 60% of buy SOL.
- Stake 0.1 SOL (capped at 1% of real SOL); up to 3 adds of 0.2 SOL while the
  position is up ≥ 30% (≥ 6 slots apart, price ≥ 5% above last buy, ≥ 2 new buyers).
- Exit at 20 slots or immediately if the creator sells. No tight TP/SL, no
  trailing stop (both ship off — see rejected ideas).
- Guardrail pacer: 0.01 SOL probe round trips keep filled coins on pace for the
  20-coin minimum over the 6-hour final window (`paceSecs` 21,600, target 25).

## Official local grade (`grade-local --driver process --worktree`)

```
net PnL   0.297800602 SOL  (return 0.0298, 90% interval -0.020 .. 0.821 SOL)
Sharpe (hourly, official)  0.239475245   (24h dev window)
trading   103 fills over 49 coins, 49 round trips, win rate 28.6%, max drawdown 0.42%
fees      0.0550 SOL curve + 0.0112 SOL tx; at 2x fees net PnL 0.228 SOL
guardrails met (49 coins hold a round trip >= 0.01 SOL, drawdown ok)
top coins 3 coins made 86% of the gains; without them net PnL is -0.02 SOL
determinism: L1 regrade reproduced byte for byte
result_sha256 5568dd3c1d7a07a72091b68d54f7045bd24e3d541fe0188a690bc21a1acbd2b5
(note: result differs from the server's only because this VM runs Node v24.22.1
 vs the server's v26.13.1)
```

## Local sim numbers (tools/sharpe.ts, default fail-key draw)

- net **+0.304 SOL**, Sharpe24h 0.247, **6h chunks −0.34 / +0.35 / +0.44 / +0.24
  (median 0.347)**, 51 coins, 51 trips, 29% wins, max drawdown 0.42%,
  ex-top-3 net −0.014 SOL. (Sim runs ~0.006 SOL above the official grade because
  the phase seed differs — the failed-tx draw, not the strategy.)
- 5 fail-key draws: net 0.303–0.305 SOL, Sharpe24h 0.246–0.248 — the failed-tx
  draw barely matters.
- Coin-subset robustness (`tools/robust.ts`): 60% of coins → median +0.247 SOL,
  0/10 negative; 30% of coins (≈ final-window scale) → median +0.007 SOL,
  4/10 negative, range −0.012…+0.318.
- Official stress (`grade-local --stress 20`): median **−0.04 SOL**,
  p10 −0.08, p90 0.00; **17/20 copies lost money**; dev score above 20/20 copies.
  Warnings: dev score above 90% of rebuilt copies; half or more lost money.

## Honest read

The dev score leans on this window's coins: the top 3 coins make 86% of the
gains and every tested config is ~breakeven-to-slightly-negative without them.
On a fresh 6-hour window the outcome hinges on whether 1–2 runners land among
~13 real entries (+ probes to 25 coins). The 6h time chunks say median Sharpe
0.35 with 3 of 4 chunks positive; the block-surrogate stress says the median
reshuffled window loses a little. This is a lottery ticket with a positive
tilt, not a steady earner — which is the honest expectation for a $2 bounty
whose final window is 6 hours of fresh coins.

## What was tried and rejected (with numbers)

- **Tight TP/SL exits** (TP 6–15%, SL 4–10%, hold 8–20, `tools/analyse2.ts`):
  ALL negative mean (−2.7% to −4.4% per trade). The ~2.5% round-trip curve
  fees eat small wins and capping the upside kills the tail that pays.
  Only hold-to-20 with no TP/SL has a positive mean (+2.9%, sd 27.6%).
- **Partial take-profit** (sell half at +25%/+40%) and **trailing stop**
  (arm +60%/+100%): lower net (+0.09–0.26 vs +0.34) and no Sharpe gain.
- **Loose entries** (5 buyers, wider runup, minTrades 3): more coins (129–536
  vs 84) but mean/sd per trade turns negative; med6h Sharpe −0.18…−0.30,
  net −0.6…−0.9 SOL. Early unfiltered entries are all losers in the sim
  (latency + size cap + fees kill the "first-trade" edge).
- **Longer holds** (30 slots): net +0.16–0.17, med6h 0.23 — worse than 20.
- **minBuyers 6 vs 7**: 6 gives higher net (+0.341 vs +0.304) but lower
  med6h Sharpe (0.268 vs 0.347, consistent across chunks); 7 ships.
- **stake 0.2 / exposure 3 / addSol 0.3 / maxEntries 1 / minRealSol 5**:
  flat plateau, no change — defaults kept.

## Reproduce

```sh
KIT=~/workspace/makefun/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532-kit/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532-kit
node tools/sharpe.ts $KIT                      # sim + hourly Sharpe
node tools/robust.ts $KIT '{}' 10 0.6          # coin-subset stress
node $KIT/cli/makefun.mjs grade-local --kit $KIT --bot . --driver process --worktree
node $KIT/cli/makefun.mjs grade-local --kit $KIT --bot . --driver process --worktree --stress 20 --stress-jobs 2
```

## Before submitting (NOT done — parent agent's call)

- Needs a GitHub repo created after the competition opened (2026-11-25T17:00Z)
  with README badges + About (`makefun` topic, make.fun website),
  `.makefun/owner.json` if the GitHub owner differs from the account login,
  transcripts bundle (`bundle` + `check`), then `submit`.
- Note the transcript gate: sessions must fall inside the competition window;
  this build session started after opening, but bundle/check must be run by the
  submitting agent. Quality gate applies: the dev numbers above are the honest
  basis — positive Sharpe on the dev window but jackpot-dependent (see stress).
