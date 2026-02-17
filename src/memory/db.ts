import { Database } from "bun:sqlite";
import * as fs from "fs";
import { MAX_SUMMARIES_PER_TOPIC } from "../config";

// Ensure DB directory exists
try {
  fs.mkdirSync("./db", { recursive: true });
} catch {}
export const db = new Database("./db/brain.db");
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS topics (
  topic_id TEXT PRIMARY KEY,
  user_id TEXT,
  created_at INTEGER,
  last_active INTEGER,
  label TEXT
);
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT,
  created_at INTEGER,
  text TEXT
);
CREATE TABLE IF NOT EXISTS policy (
  user_id TEXT PRIMARY KEY,
  json TEXT
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT,
  role TEXT,
  text TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS seen (
  msg_id TEXT PRIMARY KEY,
  ts INTEGER
);
`);

// Ensure new columns for users: name, nickname, intro_asked
try {
  const cols = db.prepare("PRAGMA table_info(users)").all() as {
    name: string;
  }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("name")) {
    db.exec("ALTER TABLE users ADD COLUMN name TEXT");
  }
  if (!colNames.has("nickname")) {
    db.exec("ALTER TABLE users ADD COLUMN nickname TEXT");
  }
  if (!colNames.has("intro_asked")) {
    db.exec("ALTER TABLE users ADD COLUMN intro_asked INTEGER DEFAULT 0");
  }
} catch {}

export const insertUser = db.prepare(
  "INSERT OR IGNORE INTO users(user_id) VALUES (?)",
);
export const selectUser = db.prepare(
  "SELECT user_id, name, nickname, intro_asked FROM users WHERE user_id=?",
);
export const updateUserProfile = db.prepare(
  "UPDATE users SET name=COALESCE(?, name), nickname=COALESCE(?, nickname) WHERE user_id=?",
);
export const updateIntroAsked = db.prepare(
  "UPDATE users SET intro_asked=? WHERE user_id=?",
);
export const insertTopic = db.prepare(
  "INSERT OR REPLACE INTO topics(topic_id,user_id,created_at,last_active,label) VALUES (?,?,?,?,?)",
);
export const selectLatestTopic = db.prepare(
  "SELECT * FROM topics WHERE user_id=? ORDER BY last_active DESC LIMIT 1",
);
export const insertSummary = db.prepare(
  "INSERT INTO summaries(topic_id,created_at,text) VALUES (?,?,?)",
);
export const selectSummaries = db.prepare(
  "SELECT text FROM summaries WHERE topic_id=? ORDER BY created_at DESC LIMIT ?",
);
export const countSummaries = db.prepare(
  "SELECT COUNT(*) as c FROM summaries WHERE topic_id=?",
);
export const deleteOldestSummary = db.prepare(
  "DELETE FROM summaries WHERE rowid IN (SELECT rowid FROM summaries WHERE topic_id=? ORDER BY created_at ASC LIMIT 1)",
);
export const getPolicy = db.prepare("SELECT json FROM policy WHERE user_id=?");
export const insertTurn = db.prepare(
  "INSERT INTO turns(topic_id,role,text,created_at) VALUES (?,?,?,?)",
);
export const selectRecentTurns = db.prepare(
  "SELECT role, text FROM turns WHERE topic_id=? ORDER BY created_at DESC LIMIT ?",
);
export const markSeenStmt = db.prepare(
  "INSERT OR IGNORE INTO seen(msg_id,ts) VALUES (?,?)",
);
export const isSeenStmt = db.prepare(
  "SELECT 1 FROM seen WHERE msg_id=? LIMIT 1",
);

const selectTopicsByUser = db.prepare(
  "SELECT topic_id, user_id, created_at, last_active, label FROM topics WHERE user_id=? ORDER BY last_active DESC",
);
const updateTopicUserId = db.prepare(
  "UPDATE topics SET user_id=? WHERE user_id=?",
);

export function upsertPolicy(userId: string, json: any) {
  db.prepare(
    "INSERT INTO policy(user_id,json) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET json=excluded.json",
  ).run(userId, JSON.stringify(json));
}

export function now() {
  return Date.now();
}

export function newTopicId(userId: string) {
  const t = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${userId}_${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(
    t.getDate(),
  )}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
}

export function addSummary(topicId: string, text: string) {
  insertSummary.run(topicId, now(), text);
  const cnt = countSummaries.get(topicId) as any;
  if (cnt.c > MAX_SUMMARIES_PER_TOPIC) {
    deleteOldestSummary.run(topicId);
  }
}

export function fetchContext(userId: string) {
  const latest = selectLatestTopic.get(userId) as any;
  if (!latest)
    return {
      systemPolicy: {},
      topicLabel: "",
      summaries: [] as string[],
      latest: null,
    };
  const rows = selectSummaries.all(
    latest.topic_id,
    MAX_SUMMARIES_PER_TOPIC,
  ) as { text: string }[];
  const policyRow = getPolicy.get(userId) as any;
  return {
    systemPolicy: policyRow?.json ? JSON.parse(policyRow.json) : {},
    topicLabel: latest.label || "",
    summaries: rows.map((r) => r.text).reverse(),
    latest,
  };
}

export function getUser(userId: string) {
  const row = selectUser.get(userId) as any;
  return row || null;
}

export function setUserProfile(
  userId: string,
  name?: string | null,
  nickname?: string | null,
) {
  updateUserProfile.run(name ?? null, nickname ?? null, userId);
}

export function setIntroAsked(userId: string, asked: boolean) {
  updateIntroAsked.run(asked ? 1 : 0, userId);
}

export function addTurn(
  topicId: string,
  role: "user" | "assistant",
  text: string,
) {
  insertTurn.run(topicId, role, text, now());
}

export function fetchRecentTurns(topicId: string, limit: number) {
  const rows = selectRecentTurns.all(topicId, limit) as {
    role: string;
    text: string;
  }[];
  return rows.reverse();
}

export function markSeen(messageId: string) {
  markSeenStmt.run(messageId, now());
}

export function isSeen(messageId: string) {
  const row = isSeenStmt.get(messageId) as any;
  return !!row;
}

// Migration helper: re-key legacy group topics from senderId -> chatId (room id).
// Returns true if any topic rows were moved.
export function migrateGroupTopicsToChatId(senderId: string, chatId: string) {
  if (!senderId || !chatId || senderId === chatId) return false;

  const legacyRows = selectTopicsByUser.all(senderId) as any[];
  if (!legacyRows || legacyRows.length === 0) return false;

  updateTopicUserId.run(chatId, senderId);
  return true;
}
