import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { isSetupCompleted } from "@/lib/setup";
import { SignOutButton } from "./sign-out-button";

// All dashboard routes depend on the session + DB state — never static.
export const dynamic = "force-dynamic";

const nav = [
  { href: "/dashboard", label: "Projects" },
  { href: "/dashboard/clusters", label: "Clusters" },
  { href: "/dashboard/settings/integrations", label: "Settings" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSetupCompleted())) redirect("/setup");
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between gap-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            korepush
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-1.5 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <span className="hidden md:inline">{session.user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
