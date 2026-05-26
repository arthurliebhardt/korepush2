import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    // deploy.project | rollback.deployment | delete.project | sync.domain
    kind: text("kind").notNull(),
    // queued | running | succeeded | failed | cancelled
    status: text("status").notNull().default("queued"),
    payload: jsonb("payload").notNull(),
    priority: integer("priority").notNull().default(100),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    // For at-least-once delivery: workers re-claim after visibility timeout.
    visibilityTimeoutAt: timestamp("visibility_timeout_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    dedupeKey: text("dedupe_key"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("jobs_idempotency_unique").on(t.idempotencyKey),
    index("jobs_claim_idx").on(t.status, t.runAt, t.priority),
    index("jobs_dedupe_idx").on(t.dedupeKey),
    index("jobs_kind_idx").on(t.kind, t.status),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.createdAt)],
);
