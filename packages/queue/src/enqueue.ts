import type { Database } from "@korepush/db";
import { schema } from "@korepush/db";
import type { JobKind, JobPayloadFor } from "@korepush/shared";
import { JOB_DEFAULT_MAX_ATTEMPTS } from "@korepush/shared";
import { newId } from "./id.js";

export interface EnqueueOptions {
  priority?: number;
  maxAttempts?: number;
  runAt?: Date;
  idempotencyKey?: string;
  dedupeKey?: string;
}

export interface EnqueueResult {
  jobId: string;
  deduplicated: boolean;
}

export async function enqueue<K extends JobKind>(
  db: Database,
  kind: K,
  payload: JobPayloadFor<K>,
  opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const id = newId("job");
  const row = {
    id,
    kind,
    status: "queued" as const,
    payload: payload as unknown,
    priority: opts.priority ?? 100,
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? JOB_DEFAULT_MAX_ATTEMPTS,
    runAt: opts.runAt ?? new Date(),
    idempotencyKey: opts.idempotencyKey ?? null,
    dedupeKey: opts.dedupeKey ?? null,
  };

  // Idempotent insert: on conflict on (idempotency_key), return existing row.
  if (opts.idempotencyKey) {
    const inserted = await db
      .insert(schema.jobs)
      .values(row)
      .onConflictDoNothing({ target: schema.jobs.idempotencyKey })
      .returning({ id: schema.jobs.id });

    if (inserted.length > 0) {
      return { jobId: inserted[0]!.id, deduplicated: false };
    }

    const existing = await db.query.jobs.findFirst({
      where: (j, { eq }) => eq(j.idempotencyKey, opts.idempotencyKey!),
      columns: { id: true },
    });
    if (!existing) {
      throw new Error("idempotent insert conflict but no existing row");
    }
    return { jobId: existing.id, deduplicated: true };
  }

  await db.insert(schema.jobs).values(row);
  return { jobId: id, deduplicated: false };
}
