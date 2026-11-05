export async function register() {
  // Resume the persisted send queue when the server starts (not during `next build`).
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startWorker } = await import("./lib/queue");
    startWorker();
  }
}
