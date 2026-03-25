-- strict season extrema
-- 生成时间：2026-03-25

ALTER TABLE arena_ratings ADD COLUMN season_peak_rating INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_peak_games INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_peak_at TEXT;
ALTER TABLE arena_ratings ADD COLUMN season_peak_tier TEXT;
ALTER TABLE arena_ratings ADD COLUMN season_low_rating INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_low_games INTEGER;
ALTER TABLE arena_ratings ADD COLUMN season_low_at TEXT;

UPDATE arena_ratings
SET
  season_peak_rating = rating,
  season_peak_games = games,
  season_peak_at = updated_at,
  season_peak_tier = CASE
    WHEN games < 5 OR rating < 800 THEN '无牌'
    WHEN rating < 1000 THEN '白牌'
    WHEN rating < 1200 THEN '字牌'
    WHEN rating < 1500 THEN '花牌'
    ELSE '权杖'
  END,
  season_low_rating = rating,
  season_low_games = games,
  season_low_at = updated_at
WHERE queue = 'strict'
  AND season_peak_rating IS NULL
  AND season_peak_games IS NULL
  AND season_peak_at IS NULL
  AND season_peak_tier IS NULL
  AND season_low_rating IS NULL
  AND season_low_games IS NULL
  AND season_low_at IS NULL;
