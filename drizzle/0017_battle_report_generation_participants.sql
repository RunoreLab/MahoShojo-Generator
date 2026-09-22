CREATE TABLE battle_report_generation_participants (
  generation_id TEXT NOT NULL REFERENCES battle_report_generations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT CHECK (role IS NULL OR role IN ('host', 'member')),
  PRIMARY KEY (generation_id, user_id)
);
CREATE INDEX idx_battle_report_generation_participants_user_generation
  ON battle_report_generation_participants(user_id, generation_id);
