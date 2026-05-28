import { Card, CardContent } from "@korepush/ui";
import { requireProject } from "@/lib/access";
import { ProjectSettingsForm } from "./settings-form";
import { DeleteProject } from "./delete-project";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardContent>
          <h3 className="font-medium mb-3">Project settings</h3>
          <ProjectSettingsForm
            projectId={project.id}
            initial={{
              name: project.name,
              defaultBranch: project.gitDefaultBranch,
              buildMode: project.buildMode as "dockerfile" | "railpack",
              dockerfilePath: project.dockerfilePath,
              buildContext: project.buildContext,
              port: project.port,
            }}
          />
        </CardContent>
      </Card>
      <Card className="border-red-200 dark:border-red-900/40">
        <CardContent>
          <h3 className="font-medium text-red-700 dark:text-red-400">Danger zone</h3>
          <p className="text-sm text-zinc-500 mt-1">
            Delete this project, its Kubernetes namespace, and all managed resources.
          </p>
          <div className="mt-3">
            <DeleteProject projectId={project.id} name={project.name} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
