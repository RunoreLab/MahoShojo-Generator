/**
 * Dependency-neutral Arena product/runtime capabilities.
 *
 * Consumers may impose additional byte, authority or concurrency gates, but
 * must not silently introduce a lower count limit for these same semantics.
 */
export const ARENA_CANONICAL_CAPABILITIES = Object.freeze({
  maxCombatants: 32,
  maxReferenceItemsSanity: 256,
  minCombatantsByMode: Object.freeze({
    classic: 2,
    kizuna: 2,
    daily: 1,
    scenario: 1,
  }),
});
