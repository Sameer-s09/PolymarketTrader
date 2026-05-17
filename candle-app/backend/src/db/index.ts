import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'candle.db')

export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── Migrations ────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  entry_type       TEXT NOT NULL CHECK(entry_type IN ('note','trade_note','setup','review')),
  text             TEXT NOT NULL,
  tags             TEXT,
  btc_price        REAL,
  candle_num       INTEGER,
  session          TEXT,
  odds_up          REAL,
  odds_down        REAL,
  signal_score     INTEGER,
  pct_from_c1      REAL,
  body_pct_prev    REAL,
  chart_screenshot TEXT,
  trade_id         INTEGER REFERENCES trades(id),
  news_context     TEXT
);

CREATE TABLE IF NOT EXISTS trades (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at      TEXT,
  direction        TEXT NOT NULL CHECK(direction IN ('UP','DOWN')),
  stake            REAL NOT NULL,
  odds_up          REAL NOT NULL,
  odds_down        REAL NOT NULL,
  payout           REAL NOT NULL,
  market_slug      TEXT NOT NULL,
  market_end_time  TEXT NOT NULL,
  candle_num       INTEGER NOT NULL CHECK(candle_num BETWEEN 1 AND 5),
  btc_price        REAL NOT NULL,
  pct_from_c1      REAL,
  body_pct_prev    REAL,
  signal_score     INTEGER,
  c1_open          REAL,
  session          TEXT,
  fib_382_state    TEXT,
  fib_618_state    TEXT,
  news_context     TEXT,
  outcome          TEXT CHECK(outcome IN ('WIN','LOSS') OR outcome IS NULL),
  pnl              REAL,
  resolution_price REAL,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_trades_created_at  ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_trades_outcome      ON trades(outcome);
CREATE INDEX IF NOT EXISTS idx_trades_session      ON trades(session);
CREATE INDEX IF NOT EXISTS idx_trades_candle_num   ON trades(candle_num);
CREATE INDEX IF NOT EXISTS idx_journal_created_at  ON journal_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_journal_entry_type  ON journal_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_journal_trade_id    ON journal_entries(trade_id);

CREATE TABLE IF NOT EXISTS chat_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  role         TEXT    NOT NULL CHECK(role IN ('user','assistant')),
  content      TEXT    NOT NULL,
  is_proactive INTEGER NOT NULL DEFAULT 0,
  ts           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_history(created_at);

CREATE TABLE IF NOT EXISTS candles (
  time    INTEGER PRIMARY KEY,
  open    REAL    NOT NULL,
  high    REAL    NOT NULL,
  low     REAL    NOT NULL,
  close   REAL    NOT NULL,
  volume  REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candles_time ON candles(time);
`)

console.log('[db] SQLite ready:', DB_PATH)
