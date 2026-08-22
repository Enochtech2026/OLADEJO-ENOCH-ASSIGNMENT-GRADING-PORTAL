'use strict';
const crypto = require('crypto');
const db = require('./db');

// --- Password hashing (scrypt, built into Node — no bcrypt dependency needed) ---

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const suppliedBuffer = crypto.scryptSync(password, salt, 64);
  if (hashBuffer.length !== suppliedBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, suppliedBuffer);
}

// --- Sessions ---
// Sliding idle timeout + hard absolute cap, enforced server-side on every request.
const IDLE_TIMEOUT_MS = 45 * 60 * 1000;        // 45 minutes of inactivity
const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours max, even if active

async function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDLE_TIMEOUT_MS);
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS);
  await db.run(
    `INSERT INTO sessions (id, user_id, created_at, last_active_at, expires_at, absolute_expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, now.toISOString(), now.toISOString(), expiresAt.toISOString(), absoluteExpiresAt.toISOString()]
  );
  return id;
}

async function destroySession(sessionId) {
  if (!sessionId) return;
  await db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
}

/**
 * Validates a session id, enforcing idle + absolute expiration.
 * Returns the active user record, or null if the session is missing/expired.
 */
async function getSessionUser(sessionId) {
  if (!sessionId) return null;
  const session = await db.get(`SELECT * FROM sessions WHERE id = ?`, [sessionId]);
  if (!session) return null;

  const now = new Date();
  if (now > new Date(session.expires_at) || now > new Date(session.absolute_expires_at)) {
    await db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
    return null;
  }

  const user = await db.get(`SELECT * FROM users WHERE id = ?`, [session.user_id]);
  if (!user || !user.is_active) {
    await db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
    return null;
  }

  // Sliding expiration: extend idle window, never past the absolute cap.
  const newExpiry = new Date(Math.min(
    now.getTime() + IDLE_TIMEOUT_MS,
    new Date(session.absolute_expires_at).getTime()
  ));
  await db.run(`UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE id = ?`,
    [now.toISOString(), newExpiry.toISOString(), sessionId]);

  return user;
}

async function cleanExpiredSessions() {
  const now = new Date().toISOString();
  await db.run(`DELETE FROM sessions WHERE expires_at < ? OR absolute_expires_at < ?`, [now, now]);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getSessionUser,
  cleanExpiredSessions,
  IDLE_TIMEOUT_MS,
  ABSOLUTE_TIMEOUT_MS,
};
