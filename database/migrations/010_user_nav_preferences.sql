-- Sidebar entries each user chose to hide (JSON list of paths). Visual only: permissions are unchanged.
ALTER TABLE auth_users ADD COLUMN hidden_nav TEXT NOT NULL DEFAULT '[]';
