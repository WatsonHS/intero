CREATE UNIQUE INDEX IF NOT EXISTS pilot_coordination_work_state_unique_idx
  ON pilot_coordination_threads(work_state_id)
  WHERE work_state_id IS NOT NULL;
