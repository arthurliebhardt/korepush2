import { db } from "./db.js";
import { schema } from "@korepush/db";
import { eq } from "drizzle-orm";

export async function isSetupCompleted(): Promise<boolean> {
  const row = await db.query.platformSettings.findFirst({
    where: eq(schema.platformSettings.key, "setup_completed"),
  });
  return row?.value === true;
}

export async function markSetupCompleted(): Promise<void> {
  await db
    .insert(schema.platformSettings)
    .values({ key: "setup_completed", value: true })
    .onConflictDoUpdate({
      target: schema.platformSettings.key,
      set: { value: true, updatedAt: new Date() },
    });
}
