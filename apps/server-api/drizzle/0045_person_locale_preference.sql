ALTER TABLE "notification_preferences"
  ADD COLUMN "locale" text;

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_locale_check" CHECK (
    "locale" IS NULL OR "locale" IN ('zh-CN', 'en-US')
  );
