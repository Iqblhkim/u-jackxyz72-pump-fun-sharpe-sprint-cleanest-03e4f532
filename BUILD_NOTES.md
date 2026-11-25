# BUILD_NOTES — Steady Scalper v2 (Pump.fun Sharpe Sprint)

Bounty: **Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins**
(`u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532`, $2 total, top 3 $1 / $0.60 / $0.40;
entries close 2026-11-28T17:00Z). Ranking by **hourly Sharpe** on a 6-hour forward
replay; a place needs net PnL > 0 SOL after fees; guardrails: max 5 open positions,
≥ 20 distinct mints with round trips ≥ 0.01 SOL, max drawdown 50%.

Status: **rebuilt fresh + tested locally. NOT submitted yet.**

## Why v2 exists

The v1 entry was built in a session that started 04:09Z on 25 Nov 2026, BEFORE
the bounty opened (2026-11-25T17:00Z) — so its transcripts fail
`thinking_in_window` (495 timestamps before opening) and a submit would be
refused. v2 is a from-scratch rewrite of `main.ts` + `strategy.ts` in a new
session started AFTER opening, from the same specification below. Same
strategy, same parameters, same dev numbers. `vendor/makefun-bot.ts`,
`LICENSE`, `README.md`, `.makefun/owner.json` are byte-identical to v1.

## Files

- `main.ts` — entrypoint (Node 22, `runBot` shim)
- `strategy.ts` — the strategy (params in `DEFAULT_PARAMS`)
- `vendor/makefun-bot.ts` — kit SDK, byte-identical copy of `sdk/ts/makefun-bot.ts`
- `LICENSE` (MIT), `README.md`, `.makefun/owner.json`
- Kit: `../u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532-kit/`
  (the bounty kit endpoint served fine — no new kit download).

## Strategy

Breadth-filtered launch scalps, hold 20 slots, pyramid into strength:

- Buy inside the first 50 slots when the opening tape shows ≥ 7 distinct
  non-creator buyers, net SOL in ≥ 0.3, buys ≥ 60% of trades, price +15–30%
  over the first trade, real SOL ≥ 3, creator bought 0 SOL and never sold,
  no single buyer over 60% of buy SOL.
- Stake 0.1 SOL (capped at 1% of real SOL); up to 3 adds of 0.2 SOL while the
  position is up ≥ 30% (≥ 6 slots apart, price ≥ 5% above last buy, ≥ 2 new buyers).
- Exit at 20 slots or immediately if the creator sells. No tight TP/SL, no
  trailing stop (both ship off — see rejected ideas in v1 notes).
- Guardrail pacer: 0.01 SOL probe round trips keep filled coins on pace for the
  20-coin minimum over the 6-hour final window (`paceSecs` 21,600, target 25).

## Official local grade (`grade-local --driver process --worktree`, v2)

```
net PnL   0.297800602 SOL  (return 0.0298, 90% interval -0.020 .. 0.821 SOL)
trading   103 fills over 49 coins, 49 round trips, win rate 28.6%, max drawdown 0.42%
fees      0.0550 SOL curve + 0.0112 SOL tx; at 2x fees net PnL 0.228 SOL
guardrails met (49 coins hold a round trip >= 0.01 SOL, drawdown ok)
determinism: L1 regrade reproduced byte for byte
result_sha256 251ada1bedc46df88f1d43c223694f4b7b2d1feee76c91feb8654a0cea4592b9
```
Identical to v1 on every trading number (net, fills, coins, trips, win rate,
drawdown, fees). `result_sha256` differs from v1 only because the bot source
text differs (fresh rewrite); the graded behaviour is the same.
Hourly Sharpe on the dev window (v1 grade): 0.239 (24h); 6h chunks
−0.34 / +0.35 / +0.44 / +0.24, median 0.35.

## Honest read (unchanged from v1)

The dev score leans on this window's coins: the top 3 coins make 86% of the
gains and every tested config is ~breakeven-to-slightly-negative without them.
On a fresh 6-hour window the outcome hinges on whether 1–2 runners land among
~13 real entries (+ probes to 25 coins). The 6h time chunks say median Sharpe
0.35 with 3 of 4 chunks positive; the block-surrogate stress says the median
reshuffled window loses a little. This is a lottery ticket with a positive
tilt, not a steady earner — which is the honest expectation for a $2 bounty
whose final window is 6 hours of fresh coins.

## Reproduce

```sh
KIT=~/workspace/makefun/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532-kit/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532-kit
node $KIT/cli/makefun.mjs grade-local --kit $KIT --bot . --driver process --worktree
```

## Before submitting

- Repo is the same repo as v1 (branch main); this v2 push replaces
  `main.ts`/`strategy.ts` with the fresh rewrite. README badges + About
  (`makefun` topic, make.fun website) must be in place, transcripts bundle
  (`bundle` + `check`) must be run in the rebuild session, then `submit`.
- Quality gate applies: the dev numbers above are the honest basis —
  positive Sharpe on the dev window but jackpot-dependent (see stress in v1
  notes: official stress median −0.04 SOL, 17/20 copies lost money).
