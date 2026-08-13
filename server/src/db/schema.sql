-- ═══════════════════════════════════════════════════════════════════════════
-- Nook — libSQL / SQLite schema
--
-- Written as plain DDL rather than generated migrations: there is one schema,
-- it runs at boot, and every statement is idempotent. That keeps "clone and
-- run" true, and means Turso and a local file behave identically.
--
-- Design notes worth knowing:
--
--   * IDs are 24-char hex strings, not integers. Mongo's ObjectId format is
--     kept so existing client code, cached data and URLs stay valid.
--   * Timestamps are INTEGER milliseconds since epoch. Comparable, sortable,
--     and no timezone ambiguity.
--   * Mongo's nested arrays become real tables. Reactions, reads, pins and
--     the rest are now queryable and countable, which they never were before.
--   * Small fixed-shape blobs (a wallpaper, a room's mood) stay as JSON
--     columns. Normalising a single-row-per-conversation object into its own
--     table buys nothing.
-- ═══════════════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ── users ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  username          TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  password_hash     TEXT NOT NULL,

  email             TEXT NOT NULL DEFAULT '',
  email_verified    INTEGER NOT NULL DEFAULT 0,
  recovery_code     TEXT NOT NULL DEFAULT '',
  recovery_expires  INTEGER,

  avatar_url        TEXT NOT NULL DEFAULT '',
  about             TEXT NOT NULL DEFAULT 'Somewhere quiet.',
  accent            TEXT NOT NULL DEFAULT 'terracotta',

  last_seen         INTEGER NOT NULL DEFAULT 0,
  online            INTEGER NOT NULL DEFAULT 0,
  last_nudge_at     INTEGER,

  privacy           TEXT NOT NULL DEFAULT '{}',   -- json
  settings          TEXT NOT NULL DEFAULT '{}',   -- json
  quiet_hours       TEXT NOT NULL DEFAULT '{}',   -- json

  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- Contacts and blocks: directed edges between users.
CREATE TABLE IF NOT EXISTS user_contacts (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, contact_id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);

-- Folders are private to the user who made them.
CREATE TABLE IF NOT EXISTS folders (
  id         TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS folder_conversations (
  user_id         TEXT NOT NULL,
  folder_id       TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, folder_id, conversation_id)
);

-- ── spaces (workspaces) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spaces (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'business',
  owner_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  branding       TEXT NOT NULL DEFAULT '{}',
  retention_days INTEGER NOT NULL DEFAULT 0,
  invite_code    TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS space_members (
  space_id  TEXT NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);

-- ── conversations ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL,                 -- 'direct' | 'group'
  space_id           TEXT REFERENCES spaces (id) ON DELETE SET NULL,

  name               TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  avatar_url         TEXT NOT NULL DEFAULT '',
  invite_code        TEXT NOT NULL DEFAULT '',
  created_by         TEXT REFERENCES users (id) ON DELETE SET NULL,

  wallpaper          TEXT NOT NULL DEFAULT '{}',    -- json
  wallpaper_schedule TEXT NOT NULL DEFAULT '{}',    -- json
  room_state         TEXT NOT NULL DEFAULT '{}',    -- json

  disappear_after    INTEGER NOT NULL DEFAULT 0,
  slow_mode          INTEGER NOT NULL DEFAULT 0,
  retention_days     INTEGER NOT NULL DEFAULT 0,

  last_message_id    TEXT,
  last_activity      INTEGER NOT NULL,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_activity ON conversations (last_activity DESC);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  joined_at       INTEGER NOT NULL,
  muted           INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0,
  locked          INTEGER NOT NULL DEFAULT 0,
  unread          INTEGER NOT NULL DEFAULT 0,
  last_read_at    INTEGER,
  draft           TEXT NOT NULL DEFAULT '',
  sound           TEXT NOT NULL DEFAULT 'default',
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members (user_id);

-- Every wallpaper a room has worn. The visual diary.
CREATE TABLE IF NOT EXISTS wallpaper_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  look            TEXT NOT NULL,                   -- json
  set_by          TEXT,
  at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallpaper_history_convo ON wallpaper_history (conversation_id, at);

-- Things pinned to the wall itself rather than the message list.
CREATE TABLE IF NOT EXISTS wall_objects (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  type            TEXT NOT NULL DEFAULT 'note',
  text            TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL DEFAULT '',
  date            INTEGER,
  x               REAL NOT NULL DEFAULT 50,
  y               REAL NOT NULL DEFAULT 50,
  created_by      TEXT,
  at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wall_objects_convo ON wall_objects (conversation_id);

-- ── messages ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type             TEXT NOT NULL DEFAULT 'text',
  body             TEXT NOT NULL DEFAULT '',

  media            TEXT,                            -- json, null when none
  link_preview     TEXT,                            -- json, null when none
  transcript       TEXT NOT NULL DEFAULT '',

  reply_to_id      TEXT,
  forwarded_from   TEXT,
  thread_root_id   TEXT,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  thread_updated_at INTEGER,

  call_kind        TEXT,
  call_status      TEXT,
  call_duration    INTEGER NOT NULL DEFAULT 0,

  view_once        INTEGER NOT NULL DEFAULT 0,
  burnt_at         INTEGER,

  deleted_for_all  INTEGER NOT NULL DEFAULT 0,
  edited_at        INTEGER,

  scheduled_for    INTEGER,
  delivered        INTEGER NOT NULL DEFAULT 1,
  expires_at       INTEGER,

  client_id        TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL
);

-- The index the message list actually uses: one conversation, newest first,
-- main stream only (thread replies excluded), delivered only.
CREATE INDEX IF NOT EXISTS idx_messages_stream
  ON messages (conversation_id, thread_root_id, delivered, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_root_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_scheduled ON messages (delivered, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_messages_expiry ON messages (expires_at);

-- Arrays that used to live inside a message document.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)          -- one reaction per person
);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at         INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_deliveries (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at         INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_stars (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at         INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_deletions (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_views (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at         INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_mentions (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);

-- Previous versions of an edited message.
CREATE TABLE IF NOT EXISTS message_edits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_edits ON message_edits (message_id, at);

-- Pinned messages, shared by everyone in the conversation.
CREATE TABLE IF NOT EXISTS pins (
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  pinned_by       TEXT,
  at              INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, message_id)
);

-- ── full-text search ───────────────────────────────────────────────────────
-- FTS5 is a genuine upgrade on what we had: real ranked search with prefix
-- matching, instead of a regex scan over every message body.

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5 (
  body,
  content = 'messages',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF body ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO messages_fts (rowid, body) VALUES (new.rowid, new.body);
END;

-- ── calls ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calls (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  caller_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  callee_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'audio',
  status          TEXT NOT NULL DEFAULT 'ringing',
  started_at      INTEGER NOT NULL,
  answered_at     INTEGER,
  ended_at        INTEGER,
  duration        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls (caller_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls (callee_id, started_at DESC);

-- ── push subscriptions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);

-- ── guest links ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guest_links (
  code            TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  created_by      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label           TEXT NOT NULL DEFAULT 'Guest',
  expires_at      INTEGER,
  max_uses        INTEGER NOT NULL DEFAULT 0,
  uses            INTEGER NOT NULL DEFAULT 0,
  revoked         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
