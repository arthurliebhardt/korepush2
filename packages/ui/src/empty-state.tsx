import type { ReactNode } from "react";
import { cn } from "./cn.js";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-lg border-zinc-200 dark:border-zinc-800",
        className,
      )}
    >
      <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
