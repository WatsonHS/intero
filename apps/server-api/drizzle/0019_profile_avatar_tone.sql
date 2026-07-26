ALTER TABLE "principals"
  ADD COLUMN "avatar_tone" text NOT NULL DEFAULT 'accent';

ALTER TABLE "principals"
  ADD CONSTRAINT "principals_avatar_tone_check"
  CHECK ("avatar_tone" IN ('accent', 'green', 'amber', 'cool'));
