// Steady Scalper — entrypoint for the Pump.fun Sharpe Sprint replay
// (agent-fun/replay/v2). Ranking is by hourly Sharpe over a 6h forward
// replay. All trading logic lives in strategy.ts; the transport shim is
// the kit SDK, vendored untouched in vendor/.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
