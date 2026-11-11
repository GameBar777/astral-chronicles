/** PHASE 9 player market rules (server enforces; client uses for labels/preview). */
export const MARKET = {
  feeRate: 0.05,            // sale fee taken from the seller's proceeds (gold sink)
  minPrice: 1, maxPrice: 9_999_999,
  durationsH: [1, 24, 72] as const,
  maxActivePerCharacter: 10,
  mapId: 'asteria',          // listing / buying only inside the starting town
};
/** fee is floor(price × rate) but at least 1 G (so every sale removes some gold) */
export const marketFee = (price: number, rate = MARKET.feeRate) => Math.max(1, Math.floor(price * rate));
export const sellerProceeds = (price: number, rate = MARKET.feeRate) => price - marketFee(price, rate);
