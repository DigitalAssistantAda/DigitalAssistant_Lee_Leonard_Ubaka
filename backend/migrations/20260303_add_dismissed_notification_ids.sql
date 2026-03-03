-- Store which notifications the user has dismissed (hide from list)
ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS dismissed_notification_ids JSONB DEFAULT '{"deletion_request_ids": [], "mention_ids": []}'::jsonb;
