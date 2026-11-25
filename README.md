[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/Iqblhkim/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/Iqblhkim/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

# Steady Scalper — Pump.fun Sharpe Sprint

A paper-trading bot for the [Pump.fun Sharpe Sprint — Cleanest Paper Bot Wins](https://make.fun/c/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) bounty on make.fun. One strategy program, `main.ts` on Node 22, trading paper money on a 6-hour pump.fun forward replay. Ranking is by **hourly Sharpe ratio**, not net PnL.

## Strategy (see `strategy.ts`, full notes in `BUILD_NOTES.md`)

Breadth-filtered launch scalps, held ~20 slots, with pyramiding into strength:

- Watch every coin from its `CreateEvent`; buy inside the first 50 slots when the opening tape shows ≥ 7 distinct non-creator buyers, net SOL in ≥ 0.3, buys ≥ 60% of trades, price +15–30% over the first trade, real SOL ≥ 3, creator bought 0 SOL and never sold, no single buyer over 60% of buy SOL.
- Stake 0.1 SOL per entry (capped at 1% of real SOL); add up to 3 × 0.2 SOL while the position is up ≥ 30%.
- Exit at 20 slots or immediately if the creator sells. No tight take-profit / stop-loss: on this data every tight TP/SL variant has a negative mean (fees eat small wins; the edge lives in the right tail).
- Guardrail pacer: tiny 0.01 SOL probe round trips keep the filled-coin count on pace for the 20-coin minimum over the 6-hour final window.
- Pure function of the batches: no clock, no randomness, no I/O — the two graded executions reproduce byte for byte.

## Local results (kit dev window, 24h, 2–3 Nov 2026)

Official `grade-local --driver process`:

| metric | value |
| --- | --- |
| Net PnL | **+0.298 SOL** (return +2.98%) |
| Hourly Sharpe | **0.239** (24h); 6h chunks −0.34 / +0.35 / +0.44 / +0.24, median **0.35** |
| Coins / round trips | 49 / 49 (guardrails met) |
| Win rate | 28.6% |
| Max drawdown | 0.42% (limit 50%) |
| Determinism | L1 regrade reproduced byte for byte |
| Net at 2× fees | +0.228 SOL |

Honest caveat: the top 3 coins made 86% of the gains; without them net is −0.02 SOL, and the 90% bootstrap interval is −0.02 … +0.82 SOL. The final 6-hour window is a fresh draw — see `BUILD_NOTES.md` for the stress numbers.

## Reproduce

```sh
# kit lives next to this directory as u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532-kit/
node tools/sharpe.ts <kit dir>            # full-window sim + hourly Sharpe
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree
```

## License

MIT — see `LICENSE`.
