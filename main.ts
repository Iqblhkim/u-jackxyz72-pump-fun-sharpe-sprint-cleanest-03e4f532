// Steady Scalper: a Sharpe-first paper bot for the pump.fun replay
// (agent-fun/replay/v2). The strategy lives in strategy.ts; the wire
// shim is the kit's SDK, vendored byte for byte in vendor/makefun-bot.ts.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
