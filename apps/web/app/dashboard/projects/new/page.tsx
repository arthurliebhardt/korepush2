import { Card, CardContent } from "@korepush/ui";
import { NewProjectForm } from "./new-project-form";

export default function NewProjectPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New project</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Connect a Git repository. We&apos;ll build using its Dockerfile and deploy to your local
          K3s cluster.
        </p>
      </div>
      <Card>
        <CardContent>
          <NewProjectForm />
        </CardContent>
      </Card>
    </div>
  );
}
