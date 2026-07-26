ALTER TABLE pilot_agent_bindings
  ADD COLUMN IF NOT EXISTS validated_at timestamp with time zone;
