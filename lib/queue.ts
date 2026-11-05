import nodemailer, { type Transporter } from "nodemailer";
import { cols, render, type CampaignDoc, type EmailDoc, type SmtpDoc } from "./db";

type WorkerState = {
  running: boolean;
  wake?: () => void;
  transporter?: Transporter;
  transporterKey?: string;
};

const g = globalThis as unknown as { __bulkemailWorker?: WorkerState };
const state: WorkerState = g.__bulkemailWorker ?? (g.__bulkemailWorker = { running: false });

export function makeTransport(cfg: SmtpDoc): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: !!cfg.secure,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
  });
}

/** RFC 5322 "From" header value for the configured sender. */
export function fromHeader(cfg: SmtpDoc): string {
  return cfg.fromName ? `"${cfg.fromName.replace(/"/g, "")}" <${cfg.fromEmail}>` : cfg.fromEmail;
}

function transportFor(cfg: SmtpDoc): Transporter {
  const key = JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.username, cfg.password]);
  if (!state.transporter || state.transporterKey !== key) {
    state.transporter?.close();
    state.transporter = makeTransport(cfg);
    state.transporterKey = key;
  }
  return state.transporter;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    state.wake = () => {
      clearTimeout(t);
      resolve();
    };
  });

type Job = { email: EmailDoc; campaign: CampaignDoc; cfg: SmtpDoc };

/**
 * Atomically claim the oldest pending email whose campaign isn't paused and whose owner has SMTP settings.
 * findOneAndUpdate makes the claim race-free, so two server processes never send the same email.
 * (Emails of users without SMTP settings simply wait instead of blocking everyone else.)
 */
async function claimNext(): Promise<Job | null> {
  const { smtp, emails, campaigns } = await cols();
  const owners = await smtp.distinct("_id");
  if (owners.length === 0) return null;

  for (;;) {
    const email = await emails.findOneAndUpdate(
      { status: "pending", paused: false, userId: { $in: owners } },
      { $set: { status: "sending", updatedAt: new Date() }, $inc: { attempts: 1 } },
      { sort: { _id: 1 }, returnDocument: "after" },
    );
    if (!email) return null;

    const [campaign, cfg] = await Promise.all([
      campaigns.findOne({ _id: email.campaignId }),
      smtp.findOne({ _id: email.userId! }),
    ]);
    if (campaign && cfg) return { email, campaign, cfg };
    await emails.updateOne(
      { _id: email._id },
      { $set: { status: "failed", error: "Campaign or SMTP settings no longer exist", updatedAt: new Date() } },
    );
  }
}

async function send({ email, campaign, cfg }: Job): Promise<string | null> {
  try {
    await transportFor(cfg).sendMail({
      from: fromHeader(cfg),
      to: email.to,
      subject: render(campaign.subject, email.data),
      html: render(campaign.body, email.data, true),
      replyTo: campaign.replyTo || undefined,
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function loop() {
  const { emails } = await cols();
  // A crash/restart mid-send leaves emails in 'sending'; put them back in the queue.
  // (Assumes a single app process owns the queue; with several, use a lease timestamp instead.)
  await emails.updateMany({ status: "sending" }, { $set: { status: "pending", updatedAt: new Date() } });

  while (true) {
    let job: Job | null;
    try {
      job = await claimNext();
    } catch (err) {
      console.error("[bulkemail] queue: database error, retrying in 5s", err);
      await sleep(5000);
      continue;
    }
    if (!job) {
      await sleep(5000); // idle; kick() wakes us early when new work arrives
      continue;
    }

    const error = await send(job);
    const now = new Date();
    await emails
      .updateOne(
        { _id: job.email._id },
        error
          ? { $set: { status: "failed", error, updatedAt: now } }
          : { $set: { status: "sent", error: null, sentAt: now, updatedAt: now } },
      )
      .catch((e) => console.error("[bulkemail] queue: could not record result for", job.email._id.toHexString(), e));

    // Throttle between emails (one-by-one sending).
    await new Promise((r) => setTimeout(r, Math.max(0, job.cfg.delayMs)));
  }
}

/** Start the background worker once per server process. */
export function startWorker() {
  if (state.running) return;
  state.running = true;
  loop().catch((err) => {
    console.error("[bulkemail] worker stopped; it restarts on the next queue activity", err);
    state.running = false;
  });
}

/** Start the worker if needed and wake it up if idle. */
export function kick() {
  startWorker();
  state.wake?.();
}
