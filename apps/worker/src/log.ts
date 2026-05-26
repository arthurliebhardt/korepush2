type Level = "debug" | "info" | "warn" | "error";

function fmt(level: Level, ctx: Record<string, unknown>, msg: string): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx });
}

export function makeLogger(base: Record<string, unknown> = {}) {
  return {
    debug: (ctx: Record<string, unknown> | string, msg?: string) => emit("debug", base, ctx, msg),
    info: (ctx: Record<string, unknown> | string, msg?: string) => emit("info", base, ctx, msg),
    warn: (ctx: Record<string, unknown> | string, msg?: string) => emit("warn", base, ctx, msg),
    error: (ctx: Record<string, unknown> | string, msg?: string) => emit("error", base, ctx, msg),
    child: (extra: Record<string, unknown>) => makeLogger({ ...base, ...extra }),
  };
}

function emit(
  level: Level,
  base: Record<string, unknown>,
  ctx: Record<string, unknown> | string,
  msg?: string,
) {
  if (typeof ctx === "string") {
    console.log(fmt(level, base, ctx));
  } else {
    console.log(fmt(level, { ...base, ...ctx }, msg ?? ""));
  }
}

export const log = makeLogger({ service: "worker" });
