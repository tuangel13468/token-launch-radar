// Token Launch Radar — model radar-2.
//
// One snapshot of the protocol universe in, one ranked board out. The board covers every slug in
// the snapshot's watchlist (the floor, never a ceiling) and every other protocol that passes the
// house's own launch-subject rule, above or below the watchlist floor: no token recorded, and
// not a wrapped, staked or bridged product of a token that already trades. That rule is the
// one the snapshot's watchlist was built with, minus its $50M TVL floor, so the board finds
// the early subjects the list leaves out without ranking wrappers of tokens that trade —
// WBTC, Binance staked ETH and USDT0 are named in the rules as off the list for exactly that
// reason, and they stay off this board too. The live-token protocols are kept apart and shown
// with the market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, never from a hand-kept list of
// names. The one number the model does not take from a single protocol's row is the category
// multiple, and that too comes from the snapshot: for each category it is the median
// market-cap-to-TVL ratio of that category's protocols whose token already trades, clamped to
// [0.05, 2.0], with the global median across all live-token protocols as the fallback. A category
// with no live protocol at all falls back the same way. So a lending protocol is priced like
// lending protocols trade, a DEX like DEXes trade, and a category the snapshot has never priced
// gets the market's middle.
//
//   base      = tvl_usd x category_multiple
//   growth    = clamp(change_7d, -50, 150) per cent
//   growthMult= 1 + (growth / 100) x 0.6
//   maturity  = 0.7 + 0.3 x min(age_days, 1095) / 1095   (age unknown: 0.85)
//   breadth   = 1 + 0.04 x min(chains - 1, 5)
//   implied   = max(1, round(base x growthMult x maturity x breadth))
//
// TVL is size, the category multiple is what the market pays for that size, growth is momentum,
// maturity is how long the protocol has run with no token recorded, and breadth is how widely it
// is already distributed across chains. The constants are stated in the dashboard and in the
// sandbox there, which recomputes the same arithmetic in the page.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_multiplier: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_multiplier: 0.85,
  breadth_per_chain: 0.04,
  breadth_max_chains: 5,
  multiple_floor: 0.05,
  multiple_cap: 2.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Already trading view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row, with its farm plan as board.json carries it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multiples: Record<string, number>;
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted list of numbers; null when it holds none. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category multiples, derived from the snapshot's own live-token protocols: for each
 * category, the median market-cap-to-TVL ratio of its protocols whose token already trades,
 * clamped to the model's floor and cap. The global multiple is the same median over every
 * live-token protocol, and the fallback for a category with no live protocol at all.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): { byCategory: Record<string, number>; global: number } {
  const perCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? '';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  all.sort((a, b) => a - b);
  const clamp = (n: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, n));
  const global = clamp(median(all) ?? 0.25);
  const byCategory: Record<string, number> = {};
  for (const [key, ratios] of perCategory) {
    ratios.sort((a, b) => a - b);
    byCategory[key] = clamp(median(ratios) ?? global);
  }
  return { byCategory, global };
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  categoryMultiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult =
    age === null
      ? model.unknown_age_multiplier
      : model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, model.breadth_max_chains));
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const base = protocol.tvl_usd * categoryMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/**
 * Whether a protocol records no token at all (no market cap, CoinGecko id or symbol).
 * That alone does not make it a launch subject: a wrapped or staked product of a token
 * that already trades records no token of its own, and its "launch" already happened.
 */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories the house's watchlist rule keeps off the list: bridges, liquid staking and restaking, and exchanges. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names the house's rule keeps off the list when a protocol's name begins with one. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is a genuine token-launch subject: the house's watchlist rule, minus
 * its $50M TVL floor (a subject below the floor is no worse a subject). No token recorded,
 * and not a wrapped, staked or bridged product of a token that already trades: its category
 * is not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX,
 * its name does not end in a version marker (a space followed by V2, v2 or 2.0), carries no
 * whole word wrapped, staked or staking, and does not begin with an exchange's name.
 * The snapshot carries no parent protocol, so that part of the house rule cannot be applied;
 * the watchlist itself is still covered in full, which the build asserts.
 */
export function isLaunchSubject(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (/\s(V2|v2|2\.0)$/.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; multiples: { byCategory: Record<string, number>; global: number } } {
  const multiples = categoryMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // Every genuine launch subject, watchlist or not, above or below the floor: the watchlist
  // is the floor the board must cover, and the rest of the subjects are the early radar the
  // board exists to find. Wrapped, staked and bridged products of tokens that trade are out.
  for (const p of snapshot.protocols) {
    if (isLaunchSubject(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const multiple = multiples.byCategory[p.category ?? ''] ?? multiples.global;
    const { implied, growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(p, snapshot.as_of, model, multiple);
    return { p, multiple, implied, growthPct, growthMult, maturityMult, breadthMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.multiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, multiples };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas for one onchain action, from the protocol's first chain. */
function gasFor(chain: string): number {
  return chain === 'Ethereum' ? 8 : 3;
}

/** Gas for one weekly onchain action, from the protocol's first chain. */
function gasWeeklyFor(chain: string): number {
  return chain === 'Ethereum' ? 4 : 1;
}

/** What one farm position is built from: the protocol's own name, capital, chain and hold. */
interface PlanCtx {
  name: string;
  capital: number;
  half: number;
  quarter: number;
  chain: string;
  hold: number;
  gas: number;
  weeklyGas: number;
}

/** One category's own actions: the setup, the open, the weekly habit, a second action, the hold. */
interface CategoryPlan {
  setup?: FarmStep;
  open: FarmStep;
  weekly: FarmStep;
  extra: FarmStep;
  hold?: FarmStep;
}

/** The setup every onchain plan starts with: a fresh wallet, nothing else in it. */
function walletSetup(): FarmStep {
  return {
    text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
    cost: 'under $3 of gas for the first transaction',
    time: '5 minutes',
  };
}

/** The hold every plan ends on: the position stays put long enough to be counted twice. */
function defaultHold(c: PlanCtx): FarmStep {
  return {
    text: `Hold the position for at least ${c.hold} days so the activity is counted in more than one snapshot.`,
    cost: `the $${c.capital} stays in the position`,
    time: `${c.hold} days`,
  };
}

/** The rewards check, kept conditional: a protocol may publish no page at all. */
function rewardsStep(name: string): FarmStep {
  return {
    text: `If ${name} publishes a points or rewards page, open it from the link it publishes and check what you earned.`,
    cost: 'no fee to check, and never pay to claim',
    time: '10 minutes',
  };
}

/** The log every plan ends with: the record that lets a farmer repeat or unwind it. */
function logStep(): FarmStep {
  return {
    text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
    cost: 'nothing but the log',
    time: '5 minutes',
  };
}

/** One open step: the capital in, the gas beside it. */
function openStep(text: string, c: PlanCtx): FarmStep {
  return { text, cost: `$${c.capital} of capital and about $${c.gas} of gas`, time: '15 minutes to set up' };
}

/** One weekly step: the habit, on the same wallet, once a week. */
function weeklyStep(text: string, c: PlanCtx): FarmStep {
  return { text: `${text} Do it once a week, on the same wallet, so the activity forms a pattern.`, cost: `about $${c.weeklyGas} of gas a week`, time: '10 minutes a week' };
}

const dexsPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Provide $${c.capital} of liquidity to ${c.name}'s main pool on ${c.chain} in a balanced pair and keep the position open.`, c),
  weekly: weeklyStep(`Swap a small amount through the pool and add a little liquidity back.`, c),
  extra: { text: `Open a second, smaller position in another pool of ${c.name} on ${c.chain} with $${c.half} so the activity is not one pool only.`, cost: `$${c.half} of capital and about $${c.gas} of gas`, time: '15 minutes' },
});

const lendingPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Supply $${c.capital} of USDC to ${c.name} on ${c.chain} and keep the supply position open.`, c),
  weekly: weeklyStep(`Repay a small amount and re-supply it, so the position shows fresh activity.`, c),
  extra: { text: `Borrow a small amount against the supplied collateral and repay it within the week.`, cost: `about $${c.gas} of gas, and the borrow repaid in full`, time: '15 minutes' },
});

const liquidStakingPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Stake $${c.capital} of the chain's staking asset through ${c.name} on ${c.chain} and keep the receipt token.`, c),
  weekly: weeklyStep(`Claim the staking rewards and restake them through ${c.name}.`, c),
  extra: { text: `Use the receipt token as collateral in a lending market on ${c.chain} and unwind it within the week.`, cost: `about $${c.gas} of gas, and the collateral returned`, time: '15 minutes' },
});

const bridgePlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Bridge $${c.capital} of USDC to ${c.chain} through ${c.name} and use the bridged funds in its app.`, c),
  weekly: weeklyStep(`Bridge a small amount back to the chain you started from.`, c),
  extra: { text: `Spend the bridged funds once inside ${c.name}'s own app on ${c.chain}, so the bridge is not the only action on record.`, cost: `about $${c.gas} of gas`, time: '10 minutes' },
  hold: { text: `Keep the bridged funds deployed on ${c.chain} for at least ${c.hold} days before moving them again.`, cost: `the $${c.capital} stays deployed`, time: `${c.hold} days` },
});

const canonicalBridgePlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Bridge $${c.capital} of USDC through ${c.name} to ${c.chain} and use the funds on the other side.`, c),
  weekly: weeklyStep(`Bridge a small amount back through ${c.name}.`, c),
  extra: { text: `Bridge a second amount of $${c.half} through ${c.name} from a different wallet, so the activity is not tied to one address.`, cost: `$${c.half} of capital and about $${c.gas} of gas`, time: '15 minutes' },
  hold: { text: `Keep the bridged funds on ${c.chain} for at least ${c.hold} days before moving them again.`, cost: `the $${c.capital} stays on ${c.chain}`, time: `${c.hold} days` },
});

const derivativesPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Deposit $${c.capital} of USDC as margin on ${c.name} and open one small hedged position.`, c),
  weekly: weeklyStep(`Close one small position and open another, keeping the margin in place.`, c),
  extra: { text: `Top up the margin by $${c.quarter} if the market moves against the position, so it is not liquidated.`, cost: `$${c.quarter} of capital and about $${c.gas} of gas`, time: '10 minutes' },
  hold: { text: `Keep the margin on ${c.name} for at least ${c.hold} days, trading at least once a week.`, cost: `the $${c.capital} stays as margin`, time: `${c.hold} days` },
});

const yieldPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Deposit $${c.capital} into a ${c.name} vault on ${c.chain} and keep the shares.`, c),
  weekly: weeklyStep(`Compound the vault's rewards back into the same vault.`, c),
  extra: { text: `Add a second deposit of $${c.half} after two weeks so the position grows in steps.`, cost: `$${c.half} of capital and about $${c.gas} of gas`, time: '10 minutes' },
});

const yieldAggregatorPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Deposit $${c.capital} into an auto-compounding vault on ${c.name} on ${c.chain} and keep the shares.`, c),
  weekly: weeklyStep(`Move a small amount from one ${c.name} vault to another to show activity across its strategies.`, c),
  extra: { text: `Deposit the harvested rewards back into the same vault instead of withdrawing them.`, cost: `about $${c.gas} of gas`, time: '10 minutes' },
});

const riskCuratorsPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Deposit $${c.capital} into a vault curated by ${c.name} on ${c.chain} and keep the shares.`, c),
  weekly: weeklyStep(`Move a small amount between two vaults ${c.name} curates on ${c.chain}.`, c),
  extra: { text: `Add a second deposit of $${c.half} to a different vault ${c.name} curates on ${c.chain}.`, cost: `$${c.half} of capital and about $${c.gas} of gas`, time: '10 minutes' },
});

const cexPlan = (c: PlanCtx): CategoryPlan => ({
  setup: { text: `Open an account on ${c.name} and turn on two-factor authentication before you deposit anything.`, cost: 'nothing to open the account', time: '10 minutes' },
  open: { text: `Deposit $${c.capital} of USDC to ${c.name} over ${c.chain} and place one spot buy with it.`, cost: `$${c.capital} of capital and about $2 of trading fees`, time: '15 minutes to set up' },
  weekly: { text: `Place one small spot trade a week on ${c.name} so the account shows steady activity. Do it once a week, on the same account, so the activity forms a pattern.`, cost: 'about $1 of trading fees a week', time: '10 minutes a week' },
  extra: { text: `Withdraw a small amount to your own wallet and deposit it back, so the account shows flow in both directions.`, cost: 'about $2 of withdrawal fees', time: '10 minutes' },
  hold: { text: `Keep a balance on ${c.name} for at least ${c.hold} days and trade once a week.`, cost: `the $${c.capital} stays on the account`, time: `${c.hold} days` },
});

const rwaPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Mint $${c.capital} of the yield-bearing asset ${c.name} issues on ${c.chain} and hold it.`, c),
  weekly: weeklyStep(`Claim the yield the asset pays and reinvest it into the same asset.`, c),
  extra: { text: `Mint a second amount of $${c.half} after two weeks so the holding grows in steps.`, cost: `$${c.half} of capital and about $${c.gas} of gas`, time: '10 minutes' },
});

const cdpPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Lock $${c.capital} of collateral in ${c.name} on ${c.chain} and mint a small amount of its stable asset.`, c),
  weekly: weeklyStep(`Top up the collateral with a small amount to keep the ratio healthy.`, c),
  extra: { text: `Repay part of the minted stable asset and mint it again, so the position shows a full cycle.`, cost: `about $${c.gas} of gas, and the minted amount repaid in full`, time: '15 minutes' },
});

const predictionPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Deposit $${c.capital} into ${c.name} on ${c.chain} and place one position in a market.`, c),
  weekly: weeklyStep(`Settle one market and open a position in another.`, c),
  extra: { text: `Hold positions in two markets at once on ${c.name} so the activity is not a single bet.`, cost: `about $${c.gas} of gas, and the positions close at their markets' end`, time: '10 minutes' },
});

const chainPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Bridge $${c.capital} of USDC to ${c.chain} and use it in two of the chain's own apps.`, c),
  weekly: weeklyStep(`Make one transaction a week on ${c.chain} from the same wallet.`, c),
  extra: { text: `Use a second app on ${c.chain} with part of the funds so the wallet's history is not a single app.`, cost: `about $${c.gas} of gas`, time: '15 minutes' },
});

const stakingPoolPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Stake $${c.capital} through ${c.name}'s pool on ${c.chain} and keep the stake.`, c),
  weekly: weeklyStep(`Claim the pool rewards and restake them.`, c),
  extra: { text: `Add a second stake of $${c.half} after two weeks.`, cost: `$${c.half} of capital and about $${c.gas} of gas`, time: '10 minutes' },
});

const basisPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Deposit $${c.capital} of USDC as margin on ${c.name} and open one small basis position on ${c.chain}.`, c),
  weekly: weeklyStep(`Rebalance the hedge so the long and short legs stay matched.`, c),
  extra: { text: `Close the position after ${c.hold} days, take the funding earned, and open a fresh one.`, cost: `about $${c.gas} of gas, and the margin returned`, time: '15 minutes' },
  hold: { text: `Keep margin on ${c.name} for at least ${c.hold} days, rebalancing the hedge weekly.`, cost: `the $${c.capital} stays as margin`, time: `${c.hold} days` },
});

const allocatorPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Allocate $${c.capital} to a strategy ${c.name} runs on ${c.chain}.`, c),
  weekly: weeklyStep(`Review the allocation and move a small amount to a second strategy ${c.name} runs.`, c),
  extra: { text: `Add a second allocation of $${c.half} to another strategy ${c.name} runs on ${c.chain}.`, cost: `$${c.half} of capital and about $${c.gas} of gas`, time: '10 minutes' },
  hold: { text: `Leave the allocation in place for at least ${c.hold} days so the strategy is measured on a full window.`, cost: `the $${c.capital} stays allocated`, time: `${c.hold} days` },
});

const leveragedFarmingPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Deposit $${c.capital} into a leveraged farm position on ${c.name} on ${c.chain} and keep it open.`, c),
  weekly: weeklyStep(`Rebalance the leverage so the position stays within its target range.`, c),
  extra: { text: `Close part of the position after ${c.hold} days and re-open it at the same leverage.`, cost: `about $${c.gas} of gas, and the closed part returned`, time: '15 minutes' },
});

const insurancePlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Buy $${c.capital} of cover from ${c.name} on ${c.chain} and keep the policy active.`, c),
  weekly: weeklyStep(`Check the policy's status and top up the cover if the covered amount grows.`, c),
  extra: { text: `Buy a second, smaller policy from ${c.name} on ${c.chain} for a different risk.`, cost: `$${c.half} of cover and about $${c.gas} of gas`, time: '15 minutes' },
});

const paymentsPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Send $${c.capital} through ${c.name} on ${c.chain} and keep the receipt.`, c),
  weekly: weeklyStep(`Send one small payment a week through ${c.name} on ${c.chain}.`, c),
  extra: { text: `Receive one payment through ${c.name} as well, so the wallet shows flow in both directions.`, cost: `about $${c.gas} of gas`, time: '10 minutes' },
});

const btcPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Hold $${c.capital} of ${c.name}'s BTC-backed asset on ${c.chain}.`, c),
  weekly: weeklyStep(`Move a small amount of the asset and move it back.`, c),
  extra: { text: `Use the asset once in an app on ${c.chain} that accepts it, then hold it again.`, cost: `about $${c.gas} of gas`, time: '15 minutes' },
});

const cardPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Load $${c.capital} onto the card ${c.name} issues and spend a small amount with it.`, c),
  weekly: weeklyStep(`Spend a small amount with the card each week.`, c),
  extra: { text: `Top up the card by $${c.half} after two weeks.`, cost: `$${c.half} of capital and no card fee`, time: '10 minutes' },
  hold: { text: `Keep the card funded for at least ${c.hold} days so the spending forms a pattern.`, cost: `the $${c.capital} stays on the card`, time: `${c.hold} days` },
});

const genericPlan = (c: PlanCtx): CategoryPlan => ({
  open: openStep(`Deposit $${c.capital} of USDC into ${c.name} on ${c.chain} and keep the position open.`, c),
  weekly: weeklyStep(`Make one qualifying action a week, such as a deposit, a swap or a vote.`, c),
  extra: { text: `Add a second deposit of $${c.half} after two weeks.`, cost: `$${c.half} of capital and about $${c.gas} of gas`, time: '10 minutes' },
});

/** The plan a category farms with, by the snapshot's own category name. */
function planFor(category: string | null): (c: PlanCtx) => CategoryPlan {
  const c = (category ?? '').toLowerCase();
  if (c === 'dexs' || c === 'liquidity manager') return dexsPlan;
  if (c === 'lending' || c === 'uncollateralized lending' || c === 'collateral markets') return lendingPlan;
  if (c === 'liquid staking' || c === 'restaking' || c === 'liquid restaking' || c === 'restaked btc') return liquidStakingPlan;
  if (c === 'bridge' || c === 'cross chain bridge') return bridgePlan;
  if (c === 'canonical bridge') return canonicalBridgePlan;
  if (c === 'derivatives' || c === 'interest rate derivatives' || c === 'options vault') return derivativesPlan;
  if (c === 'yield' || c === 'farm') return yieldPlan;
  if (c === 'yield aggregator' || c === 'indexes') return yieldAggregatorPlan;
  if (c === 'risk curators') return riskCuratorsPlan;
  if (c === 'cex' || c === 'cedefi') return cexPlan;
  if (c === 'rwa') return rwaPlan;
  if (c === 'cdp' || c === 'cdp manager' || c === 'dual-token stablecoin' || c === 'stablecoin wrapper') return cdpPlan;
  if (c === 'prediction market') return predictionPlan;
  if (c === 'chain') return chainPlan;
  if (c === 'staking pool') return stakingPoolPlan;
  if (c === 'basis trading') return basisPlan;
  if (c === 'onchain capital allocator') return allocatorPlan;
  if (c === 'leveraged farming') return leveragedFarmingPlan;
  if (c === 'insurance') return insurancePlan;
  if (c === 'payments') return paymentsPlan;
  if (c === 'anchor btc' || c === 'decentralized btc') return btcPlan;
  if (c === 'crypto card issuer') return cardPlan;
  return genericPlan;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a hand-written
 * list of names: the category picks the actions, the TVL picks the amounts, the age picks the
 * hold, and the first chain picks the gas. No step names a product, a points program or a token
 * the snapshot does not carry; the rewards check is conditional on the protocol publishing one.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const ctx: PlanCtx = {
    name: p.name,
    capital,
    half: Math.max(25, Math.round(capital / 2)),
    quarter: Math.max(10, Math.round(capital / 4)),
    chain,
    hold,
    gas: gasFor(chain),
    weeklyGas: gasWeeklyFor(chain),
  };
  const plan = planFor(p.category)(ctx);
  return [
    plan.setup ?? walletSetup(),
    plan.open,
    plan.weekly,
    plan.extra,
    plan.hold ?? defaultHold(ctx),
    rewardsStep(p.name),
    logStep(),
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Already trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js, with the farm plan as board.json carries it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_multiples: multiples.byCategory,
    global_multiple: multiples.global,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
