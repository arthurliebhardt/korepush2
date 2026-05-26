import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProject } from "@/lib/access";
import { ProjectTabs } from "./project-tabs";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  let ctx;
  try {
    ctx = await requireProject(projectId);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-xs text-zinc-500 hover:underline">
            ← Projects
          </Link>
          <h1 className="text-xl font-semibold truncate">{ctx.project.name}</h1>
          <p className="text-xs text-zinc-500 truncate">{ctx.project.gitRepoUrl}</p>
        </div>
      </div>
      <ProjectTabs projectId={projectId} />
      <div>{children}</div>
    </div>
  );
}
