"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@korepush/ui";

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/projects/${projectId}`;
  const tabs = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/deployments`, label: "Deployments" },
    { href: `${base}/env-vars`, label: "Env Vars" },
    { href: `${base}/domains`, label: "Domains" },
    { href: `${base}/logs`, label: "Logs" },
    { href: `${base}/settings`, label: "Settings" },
  ];
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 flex gap-1">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px",
              active
                ? "border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
