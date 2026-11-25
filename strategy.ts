// Steady Scalper — paper bot for the Pump.fun Sharpe Sprint replay
// (agent-fun/replay/v2). Ranking is by HOURLY Sharpe over a 6h forward
// replay, so the design optimises many small diversified launch trades
// instead of one big bet.
//
// What the 24h dev window (2-3 Nov 2026, 1222 coins) measured:
//
//   * The only entries with a positive mean return are breadth-filtered
//     launch buys held ~20 slots with NO tight take-profit / stop-loss
//     (mean +2.9%, sd 27.6% per trade; the mean lives in the right tail).
//     Every tight TP/SL variant tested (TP 6-15%, SL 4-10%, hold 8-20)
//     has a NEGATIVE mean (-2.7% to -4.4%): the ~2.5% round-trip curve
//     fee eats small wins and capping the upside kills the tail that
//     pays. So: no tight exits; hold the full 20 slots, exit early only
//     when the creator sells.
//   * Breadth is the filter that matters: >= 7 distinct non-creator
//     buyers, net SOL >= 0.3, buys >= 60% of trades, price +15-30% over
//     the first trade, real SOL >= 3, creator bought 0 SOL and never
//     sold, no single buyer above 60% of buy SOL.
//   * Pyramiding into strength (adds while up >= 30%) raises net PnL
//     and the median 6h Sharpe on the dev window, so it ships ON.
//   * Guardrail pacer: tiny 0.01 SOL probe round trips keep the filled
//     coin count on pace for the 20-coin minimum over the 6h final
//     window (paceSecs 21600, target 25 coins).
//
// Pure function of the batches the harness sends: no clock, no random
// source, no I/O, no environment reads. Iteration is over
// insertion-ordered maps fed by the batch stream, with explicit sorts
// wherever order could otherwise depend on map iteration, so the two
// graded executions reproduce byte for byte.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Max slots after CreateEvent in which a first buy may be decided. */
  maxAge: number;
  /** Trades seen before an entry is allowed. */
  minTrades: number;
  /** Distinct non-creator buyers seen before an entry is allowed. */
  minBuyers: number;
  /** Net SOL bought (buys minus sells) over the trades seen. */
  minNetSol: number;
  /** Buys must be at least this share of all trades seen. */
  minBuyShare: number;
  /** Price must be at least this far above the first trade's price. */
  minRunup: number;
  /** ...and at most this far above it (don't chase a launch that ran). */
  maxRunup: number;
  /** Real SOL reserve window at decision time. */
  minRealSol: number;
  maxRealSol: number;
  /** Largest single non-creator buyer's share of buy SOL (1 = off). */
  maxTopShare: number;
  /** Creator's own buys in the opening tape, at most (SOL; 1e9 = off). */
  maxDevBuySol: number;
  /** Skip the coin entirely once the creator has sold any amount. */
  skipDevSold: boolean;
  /** SOL per position (capped by 1% of real reserve and free cash). */
  stakeSol: number;
  /** Smallest buy worth sending (tx fee ~0.000105 SOL per order). */
  minBuySol: number;
  /** Slippage allowed on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Exit when liquidation value falls this far under cost (1 = off). */
  stopLoss: number;
  /** Sell this fraction once up takeProfit (0 = off). */
  partialPart: number;
  /** ...at this gain over cost. */
  takeProfit: number;
  /** Trailing stop arms once value reaches cost * (1 + trailArm) (1e9 = off). */
  trailArm: number;
  /** Once armed, exit on a fall of this share from the best value. */
  trail: number;
  /** Exit after holding this many slots (unless trailing stop armed & rising). */
  maxHold: number;
  /** Slots to wait after an exit before the same coin may be bought again. */
  cooldown: number;
  /** Most first entries per coin over the run. */
  maxEntries: number;
  /** Pyramiding into strength (0 = off). */
  maxAdds: number;
  addDelay: number;
  addSol: number;
  addIfUp: number;
  addStep: number;
  addMinBuyers: number;
  /** Most SOL at cost across all positions at once (drawdown guard). */
  maxExposureSol: number;
  /** Guardrail pacing: the run must end with a round trip of >= 0.01 SOL
   * on >= 20 coins. When the bot's own filled coins lag targetCoins
   * scaled by the share of paceSecs of block time elapsed, it opens tiny
   * probe round trips (buy probeSol, sell it all as soon as the buy
   * lands) on the most liquid traded coins until back on pace.
   * paceSecs is the FINAL window (6h). */
  targetCoins: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  maxAge: 50,
  minTrades: 8,
  minBuyers: 7,
  minNetSol: 0.3,
  minBuyShare: 0.6,
  minRunup: 0.15,
  maxRunup: 0.3,
  minRealSol: 3,
  maxRealSol: 1_000_000,
  maxTopShare: 0.6,
  maxDevBuySol: 0,
  skipDevSold: true,
  stakeSol: 0.1,
  minBuySol: 0.01,
  buySlipBps: 1000,
  stopLoss: 1,
  partialPart: 0,
  takeProfit: 0.25,
  trailArm: 1_000_000_000,
  trail: 0.25,
  maxHold: 20,
  cooldown: 100,
  maxEntries: 2,
  maxAdds: 3,
  addDelay: 6,
  addSol: 0.2,
  addIfUp: 0.3,
  addStep: 0.05,
  addMinBuyers: 2,
  maxExposureSol: 2,
  targetCoins: 25,
  paceSecs: 21_600,
  probeSol: 0.01,
  maxProbes: 1,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;

interface Tape {
  created: number | null;
  creator: string | null;
  firstPrice: number;
  trades: number;
  buys: number;
  buySol: number;
  sellSol: number;
  buyers: Set<string>;
  /** SOL bought per non-creator wallet (for the top-buyer share). */
  buyerSol: Map<string, number>;
  devBuySol: number;
  devSold: boolean;
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  invested: number;
  exiting: boolean;
  filled: boolean;
  armed: boolean;
  partialTaken: boolean;
  /** Adds sent so far, plus price/slot/buyer count of the last buy. */
  adds: number;
  lastBuyPrice: number;
  lastBuySlot: number;
  buyersAtBuy: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = {
        created: null,
        creator: null,
        firstPrice: 0,
        trades: 0,
        buys: 0,
        buySol: 0,
        sellSol: 0,
        buyers: new Set(),
        buyerSol: new Map(),
        devBuySol: 0,
        devSold: false,
        entries: 0,
        lastExit: -1e12,
      };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Liquidation value in SOL of `tokens` against the mark (curve + tx fees deducted). */
  const liqValue = (vq: number, vt: number, rq: number, tokens: number, txSol: number): number => {
    if (vt + tokens <= 0) return 0;
    let q = (tokens * vq) / (vt + tokens);
    if (q > rq) q = rq;
    return (q / LAMPORTS) * (1 - CURVE_FEE) - txSol;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const traded: Pubkey[] = [];
      const tradedSet = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      void myFills;
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
          t.firstPrice = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          if (t.trades === 0 && t.firstPrice === 0) t.firstPrice = price;
          t.trades++;
          if (e.is_buy) {
            t.buys++;
            t.buySol += sol;
            if (e.user === t.creator) {
              t.devBuySol += sol;
            } else {
              t.buyers.add(e.user);
              t.buyerSol.set(e.user, (t.buyerSol.get(e.user) ?? 0) + sol);
            }
          } else {
            t.sellSol += sol;
            if (e.user === t.creator) t.devSold = true;
          }
          if (!tradedSet.has(e.mint)) {
            tradedSet.add(e.mint);
            traded.push(e.mint);
          }
        }
      }

      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) {
        pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);
      }
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // 1. Exits first, in mint order (deterministic).
      const heldMints = [...held.keys()].sort();
      for (const mint of heldMints) {
        const h = held.get(mint)!;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const rq = (mk ? Number(mk.real_quote_reserves) : Number(curve.real_quote_reserves)) / LAMPORTS;
        const tokens = Number(pos.token_amount);
        const value = liqValue(vq, vt, rq * LAMPORTS, tokens, tx);
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        if (value >= cost * (1 + p.trailArm)) h.armed = true;
        const t = tapeOf(mint);
        // Partial take-profit: bank a slice once up takeProfit, once per position.
        if (
          p.partialPart > 0 &&
          !h.partialTaken &&
          !h.exiting &&
          value >= cost * (1 + p.takeProfit) &&
          !pendingByMint.has(mint) &&
          orders.length < cap
        ) {
          const part = BigInt(Math.floor(tokens * p.partialPart));
          if (part > 0n && part < pos.token_amount) {
            orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
            h.partialTaken = true;
          }
        }
        let exit = h.exiting;
        if (!exit && value < cost * (1 - p.stopLoss)) exit = true;
        if (!exit && h.armed && value < h.peakValue * (1 - p.trail)) exit = true;
        if (!exit && t.devSold) exit = true;
        if (!exit && now - h.opened > p.maxHold && !(h.armed && value > h.peakValue * 0.999)) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) {
            if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          }
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // 2. Adds into strength on held positions, in mint order (deterministic).
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let exposure = 0;
      for (const [, h] of held) exposure += h.invested;
      const addMints = [...held.keys()].sort();
      for (const mint of addMints) {
        if (orders.length >= cap) break;
        const h = held.get(mint)!;
        if (h.exiting || !h.filled || h.adds >= p.maxAdds) continue;
        if (now - h.lastBuySlot < p.addDelay) continue;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined || curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint)) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const rq = (mk ? Number(mk.real_quote_reserves) : Number(curve.real_quote_reserves)) / LAMPORTS;
        const tokens = Number(pos.token_amount);
        const value = liqValue(vq, vt, rq * LAMPORTS, tokens, tx);
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value < cost * (1 + p.addIfUp)) continue;
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        if (price < h.lastBuyPrice * (1 + p.addStep)) continue;
        const t = tapeOf(mint);
        if (t.buyers.size < h.buyersAtBuy + p.addMinBuyers) continue;
        if (exposure >= p.maxExposureSol) continue;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint)) * 0.97) / LAMPORTS;
        let amount = Math.min(capSol, p.addSol, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        orders.push({
          side: 'buy',
          mint,
          quote_lamports: BigInt(Math.floor(amount * LAMPORTS)),
          max_slippage_bps: p.buySlipBps,
        });
        free -= amount + tx;
        exposure += amount;
        h.invested += amount;
        h.adds++;
        h.lastBuyPrice = price;
        h.lastBuySlot = now;
        h.buyersAtBuy = t.buyers.size;
      }

      // 3. Probe round trips: sell the whole probe as soon as its buy has landed.
      const probeMints = [...probes.keys()].sort();
      for (const mint of probeMints) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        probes.set(mint, true);
      }

      // 4. New entries on coins that traded this slot, in first-seen order.
      for (const mint of traded) {
        if (orders.length >= cap) break;
        if (slotsLeft <= 0) break;
        if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const t = tapes.get(mint)!;
        if (t.created === null || now - t.created > p.maxAge) continue;
        if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
        if (t.trades < p.minTrades) continue;
        if (t.buyers.size < p.minBuyers) continue;
        const net = t.buySol - t.sellSol;
        if (net < p.minNetSol) continue;
        if (t.trades > 0 && t.buys / t.trades < p.minBuyShare) continue;
        if (p.skipDevSold && t.devSold) continue;
        if (t.devBuySol > p.maxDevBuySol) continue;
        let top = 0;
        for (const v of t.buyerSol.values()) if (v > top) top = v;
        if (t.buySol > 0 && top > p.maxTopShare * t.buySol) continue;
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        if (t.firstPrice <= 0) continue;
        const runup = price / t.firstPrice - 1;
        if (runup < p.minRunup || runup > p.maxRunup) continue;
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        if (rqSol < p.minRealSol || rqSol > p.maxRealSol) continue;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint)) * 0.97) / LAMPORTS;
        let amount = Math.min(capSol, p.stakeSol, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        orders.push({
          side: 'buy',
          mint,
          quote_lamports: BigInt(Math.floor(amount * LAMPORTS)),
          max_slippage_bps: p.buySlipBps,
        });
        free -= amount + tx;
        exposure += amount;
        held.set(mint, {
          opened: now,
          peakValue: 0,
          invested: amount,
          exiting: false,
          filled: false,
          armed: false,
          partialTaken: false,
          adds: 0,
          lastBuyPrice: price,
          lastBuySlot: now,
          buyersAtBuy: t.buyers.size,
        });
        t.entries++;
        slotsLeft--;
      }

      // 5. Guardrail pacing: open a probe when the bot's filled coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        if (needCoins) {
          const minRq = (p.probeSol * 10_000) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({
              side: 'buy',
              mint,
              quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)),
              max_slippage_bps: p.buySlipBps,
            });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
