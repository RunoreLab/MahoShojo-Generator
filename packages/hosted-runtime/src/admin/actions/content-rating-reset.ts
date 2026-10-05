import { INITIAL_RATING } from '../arena-policy';
import type { AdminGuardedStatement } from '../operations';

/** Mirrors the current Web resetStrictArenaRatingForDataCard rule after a character update. */
export function resetStrictRatingAfterCardUpdate(cardId: string, now: string): AdminGuardedStatement {
  return { name: 'reset-updated-character-strict-rating', sql: `UPDATE arena_ratings SET rating=?,games=0,wins=0,losses=0,draws=0,
    season_peak_rating=?,season_peak_games=0,season_peak_at=?,season_peak_tier='无牌',season_low_rating=?,season_low_games=0,season_low_at=?,
    last_delta=NULL,last_applied_at=NULL,updated_at=? WHERE entity_type='data_card' AND entity_id=? AND queue='strict'
    AND EXISTS (SELECT 1 FROM data_cards WHERE id=? AND type='character') AND {{admin_guard}}`, bindings: [INITIAL_RATING, INITIAL_RATING, now, INITIAL_RATING, now, now, cardId, cardId] };
}
