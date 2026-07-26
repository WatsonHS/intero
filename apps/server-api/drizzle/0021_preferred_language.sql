ALTER TABLE "principals"
  ADD COLUMN "preferred_language" text;

ALTER TABLE "principals"
  ADD CONSTRAINT "principals_preferred_language_check"
  CHECK ("preferred_language" IS NULL OR "preferred_language" IN ('zh-CN', 'en-US'));

UPDATE "principals" AS p
SET "preferred_language" = 'zh-CN'
FROM "auth_principals" AS ap
JOIN "user" AS u ON u.id = ap.auth_user_id
WHERE p.id = ap.principal_id
  AND u.email LIKE '%@demo.intero.test';

UPDATE "pilot_agent_tickets" AS t
SET data = jsonb_set(
  t.data,
  '{preferredLanguage}',
  to_jsonb(COALESCE(p.preferred_language, 'en-US')),
  true
)
FROM principals AS p
WHERE p.id = t.owner_id
  AND NOT (t.data ? 'preferredLanguage');

UPDATE "pilot_agent_bindings" AS b
SET data = jsonb_set(
  b.data,
  '{preferredLanguage}',
  to_jsonb(COALESCE(p.preferred_language, 'en-US')),
  true
)
FROM principals AS p
WHERE p.id = b.owner_id
  AND NOT (b.data ? 'preferredLanguage');
