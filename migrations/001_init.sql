PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'manual',
  pool_id TEXT,
  group_name TEXT NOT NULL DEFAULT '',
  address_masked TEXT NOT NULL,
  key_masked TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  api_type TEXT NOT NULL,
  test_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict TEXT,
  verdict_reason TEXT NOT NULL DEFAULT '',
  question_version TEXT,
  question TEXT,
  answer TEXT,
  error TEXT NOT NULL DEFAULT '',
  progress_json TEXT,
  comparison_json TEXT,
  fingerprint_json TEXT,
  question_image TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  duration_ms INTEGER,
  first_token_ms INTEGER,
  stream_version INTEGER NOT NULL DEFAULT 0,
  client_ip_hash TEXT
);

CREATE TABLE IF NOT EXISTS probes (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  expected_count INTEGER,
  prompt TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  verdict TEXT,
  error TEXT NOT NULL DEFAULT '',
  started_at INTEGER,
  finished_at INTEGER,
  duration_ms INTEGER,
  first_token_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tests_created_at ON tests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tests_status ON tests(status);
CREATE INDEX IF NOT EXISTS idx_probes_test_id ON probes(test_id, ordinal);

PRAGMA user_version = 1;