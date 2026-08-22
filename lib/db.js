'use strict';
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// This app can run against two kinds of storage, chosen automatically:
//
// 1. TURSO_DATABASE_URL set (+ optional TURSO_AUTH_TOKEN) — uses Turso's free
//    cloud SQLite. Data survives restarts, redeploys, and spin-downs on
//    platforms with no persistent disk (Render/Vercel free tiers, etc).
//    Get a free database at https://turso.tech (no credit card required).
//
// 2. Nothing set — falls back to a local SQLite file (DB_PATH, or
//    ./data/portal.db by default). Perfect for running locally with
//    `node server.js`, but resets on hosts with ephemeral filesystems.
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

let client;
if (TURSO_URL) {
  client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  console.log('[db] Using Turso cloud database — data will persist across restarts and redeploys.');
} else {
  const localPath = process.env.DB_PATH || path.join(DATA_DIR, 'portal.db');
  client = createClient({ url: `file:${localPath}` });
  console.log(`[db] Using local SQLite file at ${localPath}.`);
  console.log('[db] This resets on hosts with ephemeral disks (e.g. Render/Vercel free tiers).');
  console.log('[db] For free, reliable hosting, set TURSO_DATABASE_URL — see README.md.');
}

async function run(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return {
    lastInsertRowid: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null,
    changes: rs.rowsAffected,
  };
}

async function get(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows[0] || null;
}

async function all(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows;
}

async function exec(sql) {
  // execute() runs one statement at a time, so split simple schema blocks on ';'.
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    await client.execute(statement);
  }
}

async function migrate() {
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name     TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK(role IN ('Student','Lecturer','Admin')),
      matric_number TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id                  TEXT PRIMARY KEY,
      user_id             INTEGER NOT NULL,
      created_at          TEXT NOT NULL,
      last_active_at      TEXT NOT NULL,
      expires_at          TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      course_name  TEXT NOT NULL,
      title        TEXT NOT NULL,
      description  TEXT,
      due_date     TEXT,
      created_by   INTEGER NOT NULL,
      created_at   TEXT NOT NULL,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id  INTEGER NOT NULL,
      student_id     INTEGER NOT NULL,
      notes          TEXT,
      file_name      TEXT,
      file_type      TEXT,
      file_data      TEXT,
      status         TEXT NOT NULL DEFAULT 'Pending',
      grade          TEXT,
      feedback       TEXT,
      submitted_at   TEXT NOT NULL,
      graded_at      TEXT,
      FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments(course_name);
  `);

  // Migration: earlier versions of this database didn't have matric_number.
  // Adding it here means upgrading in place doesn't require deleting the DB.
  try {
    const cols = await all(`PRAGMA table_info(users)`);
    if (!cols.some((c) => c.name === 'matric_number')) {
      await client.execute(`ALTER TABLE users ADD COLUMN matric_number TEXT`);
    }
  } catch (err) {
    console.error('Migration check failed (matric_number):', err.message);
  }
}

module.exports = { run, get, all, exec, migrate };
