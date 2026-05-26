import type { Database } from "@korepush/db";
import { schema } from "@korepush/db";
import { JOB_DEFAULT_VISIBILITY_SECONDS, type JobKind, type JobPayloadFor } from "@korepush/shared";
import { sql } from "drizzle-orm";
import { newId } from "./id.js";

export interface ClaimedJob<K extends JobKind = JobKind> {
  id: string;
  kind: K;
  payload: JobPayloadFor<K>;
  attempts: number;
  maxAttempts: number;
}

export interface PollOptions {
  workerId: string;
  visibilityTimeoutSeconds?: number;
  kinds?: JobKind[];
}

/**
 * Atomically claim the next eligible job using
 * SELECT ... FOR UPDATE SKIP LOCKED -> UPDATE.
 *
 * Re-claims jobs whose visibility timeout has expired (worker crash recovery).
 */
export async function claim(db: Database, opts: PollOptions): Promise<ClaimedJob | null> {
  const visibility = opts.visibilityTimeoutSeconds ?? JOB_DEFAULT_VISIBILITY_SECONDS;
  const kindsFilter = opts.kinds && opts.kinds.length > 0
    ? sql`AND kind = ANY(${opts.kinds})`
    : sql``;

  // CTE for atomic claim. Picks the highest-priority due job that is either
  // queued or running-but-stale (visibility expired).
  const rows = await db.execute<{
    id: string;
    kind: JobKind;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  }>(sql`
    WITH next AS (
      SELECT id
      FROM jobs
      WHERE (
        (status = 'queued' AND run_at <= now())
        OR (status = 'running' AND visibility_timeout_at IS NOT NULL AND visibility_timeout_at <= now())
      )
      ${kindsFilter}
      ORDER BY priority ASC, run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs j
    SET
      status = 'running',
      attempts = j.attempts + 1,
      locked_by = ${opts.workerId},
      locked_at = now(),
      visibility_timeout_at = now() + (${visibility} || ' seconds')::interval
    FROM next
    WHERE j.id = next.id
    RETURNING j.id, j.kind, j.payload, j.attempts, j.max_attempts
  `);

  const list = rows as unknown as Array<{
    id: string;
    kind: JobKind;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  }>;

  const r = list[0];
  if (!r) return null;

  return {
    id: r.id,
    kind: r.kind,
    payload: r.payload as JobPayloadFor<JobKind>,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  };
}

export async function succeed(db: Database, jobId: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET status = 'succeeded',
        finished_at = now(),
        locked_by = NULL,
        locked_at = NULL,
        visibility_timeout_at = NULL,
        last_error = NULL
    WHERE id = ${jobId}
  `);
}

export interface FailOptions {
  retryDelaySeconds?: number;
}

/**
 * Mark a job failed. If attempts < max_attempts, re-queue with exponential backoff
 * (or supplied delay). Otherwise mark terminally failed.
 */
export async function fail(
  db: Database,
  jobId: string,
  error: string,
  opts: FailOptions = {},
): Promise<{ retried: boolean }> {
  const job = await db.query.jobs.findFirst({
    where: (j, { eq }) => eq(j.id, jobId),
    columns: { attempts: true, maxAttempts: true },
  });
  if (!job) return { retried: false };

  if (job.attempts < job.maxAttempts) {
    const backoff = opts.retryDelaySeconds ?? Math.min(60 * 2 ** job.attempts, 600);
    await db.execute(sql`
      UPDATE jobs
      SET status = 'queued',
          run_at = now() + (${backoff} || ' seconds')::interval,
          locked_by = NULL,
          locked_at = NULL,
          visibility_timeout_at = NULL,
          last_error = ${error}
      WHERE id = ${jobId}
    `);
    return { retried: true };
  }

  await db.execute(sql`
    UPDATE jobs
    SET status = 'failed',
        finished_at = now(),
        locked_by = NULL,
        locked_at = NULL,
        visibility_timeout_at = NULL,
        last_error = ${error}
    WHERE id = ${jobId}
  `);
  return { retried: false };
}

export async function recordEvent(
  db: Database,
  jobId: string,
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.jobEvents).values({
    id: newId("jobev"),
    jobId,
    type,
    message,
    metadata: metadata ?? null,
  });
}

export interface WorkerLoopOptions {
  workerId: string;
  pollIntervalMs?: number;
  visibilityTimeoutSeconds?: number;
  kinds?: JobKind[];
  signal?: AbortSignal;
  handler: (job: ClaimedJob) => Promise<void>;
  onError?: (job: ClaimedJob, err: unknown) => void;
}

/**
 * Long-running worker loop. Claims jobs serially; for concurrency, run N loops.
 */
export async function runWorker(db: Database, opts: WorkerLoopOptions): Promise<void> {
  const interval = opts.pollIntervalMs ?? 1000;

  while (!opts.signal?.aborted) {
    let job: ClaimedJob | null = null;
    try {
      job = await claim(db, {
        workerId: opts.workerId,
        visibilityTimeoutSeconds: opts.visibilityTimeoutSeconds,
        kinds: opts.kinds,
      });
    } catch (err) {
      console.error("[worker] claim failed:", err);
      await sleep(interval, opts.signal);
      continue;
    }

    if (!job) {
      await sleep(interval, opts.signal);
      continue;
    }

    try {
      await opts.handler(job);
      await succeed(db, job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      opts.onError?.(job, err);
      const { retried } = await fail(db, job.id, msg);
      await recordEvent(db, job.id, retried ? "retry" : "failed", msg.slice(0, 4000));
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
