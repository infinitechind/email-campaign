import { MongoClient, ObjectId, type Collection, type Db, type WithId } from "mongodb";

/* ------------------------------------------------------------------ Connection */

const URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/bulkemail";

/** Database name: MONGODB_DB, else the path in the URI, else "bulkemail". */
function dbName(): string {
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
  try {
    const p = new URL(URI).pathname.replace(/^\//, "");
    if (p) return decodeURIComponent(p);
  } catch {
    /* fall through */
  }
  return "bulkemail";
}

type Conn = { client: MongoClient; ready: Promise<Db> };
const g = globalThis as unknown as { __bulkemailMongo?: Conn };

function connect(): Conn {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
  const ready = client.connect().then(async (c) => {
    const db = c.db(dbName());
    await ensureIndexes(db);
    return db;
  });
  // Don't cache a failed connection — retry on the next request.
  ready.catch(() => {
    if (g.__bulkemailMongo?.ready === ready) g.__bulkemailMongo = undefined;
  });
  return { client, ready };
}

export async function getDb(): Promise<Db> {
  return (g.__bulkemailMongo ??= connect()).ready;
}

/* ------------------------------------------------------------------ Documents */

export type EmailStatus = "pending" | "sending" | "sent" | "failed";

export type UserFields = {
  googleSub: string;
  email: string;
  name: string;
  picture: string | null;
  createdAt: Date;
  lastLoginAt: Date;
};

/** _id is the sha256 of the session cookie; the raw token is never stored. */
export type SessionDoc = { _id: string; userId: ObjectId; expiresAt: Date; createdAt: Date };

/** One per user; _id is the user's id. */
export type SmtpDoc = {
  _id: ObjectId;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  delayMs: number;
  updatedAt: Date;
};
/** SMTP settings from before login existed; claimed by the first user. */
export type LegacySmtpDoc = Omit<SmtpDoc, "_id"> & { _id: string };

export type TemplateFields = {
  userId: ObjectId | null; // null = created before login existed (claimed by the first user)
  name: string;
  subject: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CampaignFields = {
  userId: ObjectId | null;
  templateId: ObjectId | null;
  name: string;
  subject: string; // snapshot of the template at send time
  body: string;
  replyTo: string | null;
  paused: boolean;
  createdAt: Date;
};

/** userId and paused are copied from the campaign so the queue can claim work with a single indexed query. */
export type EmailFields = {
  campaignId: ObjectId;
  userId: ObjectId | null;
  paused: boolean;
  to: string;
  data: Record<string, string>;
  status: EmailStatus;
  error: string | null;
  attempts: number;
  sentAt: Date | null;
  updatedAt: Date;
};

export type UserDoc = WithId<UserFields>;
export type TemplateDoc = WithId<TemplateFields>;
export type CampaignDoc = WithId<CampaignFields>;
export type EmailDoc = WithId<EmailFields>;

type MetaDoc = { _id: string; userId?: ObjectId; at?: Date };

export async function cols() {
  const db = await getDb();
  return {
    users: db.collection<UserFields>("users"),
    sessions: db.collection<SessionDoc>("sessions"),
    smtp: db.collection<SmtpDoc>("smtp"),
    smtpLegacy: db.collection<LegacySmtpDoc>("smtp_legacy"),
    templates: db.collection<TemplateFields>("templates"),
    campaigns: db.collection<CampaignFields>("campaigns"),
    emails: db.collection<EmailFields>("emails"),
    meta: db.collection<MetaDoc>("meta"),
  };
}

async function ensureIndexes(db: Db) {
  const c = <T extends object>(n: string) => db.collection<T>(n) as Collection<T>;
  await Promise.all([
    c<UserDoc>("users").createIndex({ googleSub: 1 }, { unique: true }),
    c<SessionDoc>("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), // TTL cleanup
    c<SessionDoc>("sessions").createIndex({ userId: 1 }),
    c<TemplateDoc>("templates").createIndex({ userId: 1, updatedAt: -1 }),
    c<CampaignDoc>("campaigns").createIndex({ userId: 1, _id: -1 }),
    c<EmailDoc>("emails").createIndex({ status: 1, paused: 1, userId: 1, _id: 1 }), // queue claim
    c<EmailDoc>("emails").createIndex({ campaignId: 1, status: 1 }), // per-campaign counts
    c<EmailDoc>("emails").createIndex({ campaignId: 1, _id: 1 }), // per-campaign listing
  ]);
}

/* ------------------------------------------------------------------ Helpers */

/** Parse a route id; null if it isn't a valid ObjectId. */
export function oid(id: string): ObjectId | null {
  return ObjectId.isValid(id) && /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

export async function getSmtp(userId: ObjectId): Promise<SmtpDoc | null> {
  return (await cols()).smtp.findOne({ _id: userId });
}

/**
 * Give data created before login existed (userId null) to the first user who ever signs in.
 * The meta upsert makes this happen exactly once, even with concurrent first logins.
 */
export async function claimLegacyDataIfFirst(userId: ObjectId) {
  const { meta, templates, campaigns, emails, smtp, smtpLegacy } = await cols();
  const r = await meta.updateOne({ _id: "legacyClaim" }, { $setOnInsert: { userId, at: new Date() } }, { upsert: true });
  if (!r.upsertedCount) return;
  await templates.updateMany({ userId: null }, { $set: { userId } });
  await campaigns.updateMany({ userId: null }, { $set: { userId } });
  await emails.updateMany({ userId: null }, { $set: { userId } });
  const legacy = await smtpLegacy.findOne({});
  if (legacy) {
    const { _id: _legacyId, ...rest } = legacy;
    void _legacyId;
    await smtp.updateOne({ _id: userId }, { $setOnInsert: rest }, { upsert: true });
    await smtpLegacy.deleteMany({});
  }
}

/* ------------------------------------------------------------------ API shapes (unchanged field names for the UI) */

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const templateOut = (t: TemplateDoc) => ({
  id: t._id.toHexString(),
  name: t.name,
  subject: t.subject,
  body: t.body,
  created_at: iso(t.createdAt),
  updated_at: iso(t.updatedAt),
});

export const smtpOut = (s: SmtpDoc) => ({
  host: s.host,
  port: s.port,
  secure: s.secure ? 1 : 0,
  username: s.username,
  password: "", // never send the stored password to the browser
  has_password: !!s.password,
  from_name: s.fromName,
  from_email: s.fromEmail,
  delay_ms: s.delayMs,
  updated_at: iso(s.updatedAt),
});

export const emailOut = (e: EmailDoc) => ({
  id: e._id.toHexString(),
  to_email: e.to,
  status: e.status,
  error: e.error,
  attempts: e.attempts,
  sent_at: iso(e.sentAt),
  updated_at: iso(e.updatedAt),
});

export { render } from "./render";
export { ObjectId };
