#!/usr/bin/env node
/**
 * One-time import of the old SQLite database into MongoDB.
 *
 *   node scripts/import-sqlite.mjs [path/to/bulkemail.db]
 *
 * Uses MONGODB_URI / MONGODB_DB like the app (default mongodb://127.0.0.1:27017/bulkemail).
 * Read-only on the SQLite file. Refuses to run if the target MongoDB database already has app data.
 * Sessions are not imported (everyone signs in again). Data that had no owner yet (created before
 * Google login existed) stays unowned and is claimed by the first user who signs in — same as before.
 */
import { DatabaseSync } from "node:sqlite";
import { MongoClient, ObjectId } from "mongodb";

const file = process.argv[2] ?? "data/bulkemail.db";
const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/bulkemail";
const dbName = process.env.MONGODB_DB || decodeURIComponent(new URL(uri).pathname.replace(/^\//, "")) || "bulkemail";

const sql = new DatabaseSync(file, { readOnly: true });
const tables = new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
const colsOf = (t) => (tables.has(t) ? sql.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name) : []);
const all = (t) => (tables.has(t) ? sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all() : []);
/** SQLite stored "YYYY-MM-DD HH:MM:SS" (UTC) or ISO strings. */
const date = (s) => (s ? new Date(/[TZ]/.test(s) ? s : s.replace(" ", "T") + "Z") : null);

const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 5000 });
const db = client.db(dbName);
try {
  const names = ["users", "smtp", "smtp_legacy", "templates", "campaigns", "emails", "meta"];
  for (const n of names) {
    const count = await db.collection(n).estimatedDocumentCount();
    if (count > 0) throw new Error(`MongoDB database "${dbName}" already has data in "${n}" (${count} docs) — refusing to import twice.`);
  }

  const userIds = new Map();
  const users = all("users").map((u) => {
    const _id = new ObjectId();
    userIds.set(u.id, _id);
    return {
      _id,
      googleSub: u.google_sub,
      email: u.email,
      name: u.name ?? "",
      picture: u.picture ?? null,
      createdAt: date(u.created_at),
      lastLoginAt: date(u.last_login_at),
    };
  });
  const owner = (id) => (id == null ? null : (userIds.get(id) ?? null));

  const smtpDoc = (r) => ({
    host: r.host,
    port: r.port,
    secure: !!r.secure,
    username: r.username ?? "",
    password: r.password ?? "",
    fromName: r.from_name ?? "",
    fromEmail: r.from_email,
    delayMs: r.delay_ms ?? 1000,
    updatedAt: date(r.updated_at) ?? new Date(),
  });
  const smtp = colsOf("smtp_config").includes("user_id")
    ? all("smtp_config").filter((r) => owner(r.user_id)).map((r) => ({ _id: owner(r.user_id), ...smtpDoc(r) }))
    : [];
  // Single-user era settings: either the renamed legacy table or an un-migrated smtp_config(id = 1).
  const legacyRows = tables.has("smtp_config_legacy")
    ? all("smtp_config_legacy")
    : colsOf("smtp_config").includes("user_id")
      ? []
      : all("smtp_config");
  const smtpLegacy = legacyRows.slice(0, 1).map((r) => ({ _id: "legacy", ...smtpDoc(r) }));

  const templateIds = new Map();
  const templates = all("templates").map((t) => {
    const _id = new ObjectId();
    templateIds.set(t.id, _id);
    return {
      _id,
      userId: owner(t.user_id),
      name: t.name,
      subject: t.subject,
      body: t.body,
      createdAt: date(t.created_at),
      updatedAt: date(t.updated_at),
    };
  });

  const campaignInfo = new Map();
  const campaigns = all("campaigns").map((c) => {
    const _id = new ObjectId();
    const doc = {
      _id,
      userId: owner(c.user_id),
      templateId: templateIds.get(c.template_id) ?? null,
      name: c.name,
      subject: c.subject,
      body: c.body,
      replyTo: c.reply_to ?? null,
      paused: !!c.paused,
      createdAt: date(c.created_at),
    };
    campaignInfo.set(c.id, doc);
    return doc;
  });

  if (users.length) await db.collection("users").insertMany(users);
  if (smtp.length) await db.collection("smtp").insertMany(smtp);
  if (smtpLegacy.length) await db.collection("smtp_legacy").insertMany(smtpLegacy);
  if (templates.length) await db.collection("templates").insertMany(templates);
  if (campaigns.length) await db.collection("campaigns").insertMany(campaigns);
  // Data was already owned in SQLite: don't let the next new user claim anything.
  if (users.length) await db.collection("meta").insertOne({ _id: "legacyClaim", userId: users[0]._id, at: new Date() });

  let emails = 0;
  let batch = [];
  const flush = async () => {
    if (batch.length) await db.collection("emails").insertMany(batch, { ordered: false });
    emails += batch.length;
    batch = [];
  };
  for (const e of tables.has("emails") ? sql.prepare("SELECT * FROM emails ORDER BY id").iterate() : []) {
    const c = campaignInfo.get(e.campaign_id);
    if (!c) continue; // orphaned row
    batch.push({
      _id: new ObjectId(),
      campaignId: c._id,
      userId: c.userId,
      paused: c.paused,
      to: e.to_email,
      data: JSON.parse(e.data || "{}"),
      status: e.status === "sending" ? "pending" : e.status,
      error: e.error ?? null,
      attempts: e.attempts ?? 0,
      sentAt: date(e.sent_at),
      updatedAt: date(e.updated_at) ?? new Date(),
    });
    if (batch.length >= 1000) await flush();
  }
  await flush();

  console.log(`Imported into MongoDB "${dbName}":`);
  console.table({
    users: users.length,
    smtp: smtp.length,
    "smtp (unclaimed legacy)": smtpLegacy.length,
    templates: templates.length,
    campaigns: campaigns.length,
    emails,
  });
  const unowned = templates.filter((t) => !t.userId).length + campaigns.filter((c) => !c.userId).length;
  if (unowned) console.log(`${unowned} template(s)/campaign(s) have no owner yet; the first user to sign in will own them.`);
} catch (err) {
  console.error("Import failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.close();
  sql.close();
}
