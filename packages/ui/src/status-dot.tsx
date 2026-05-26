import { cn } from "./cn.js";

type AnyStatus = string;

const colors: Record<string, string> = {
  queued: "bg-zinc-400",
  building: "bg-blue-500 animate-pulse",
  deploying: "bg-blue-500 animate-pulse",
  ready: "bg-green-500",
  healthy: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-500",
  rolled_back: "bg-yellow-500",
  degraded: "bg-yellow-500",
  offline: "bg-zinc-500",
  registered: "bg-zinc-400",
};

export function StatusDot({ status, className }: { status: AnyStatus; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", colors[status] ?? "bg-zinc-400", className)}
      aria-label={status}
    />
  );
}
