import { redirect } from "next/navigation";
import { isSetupCompleted } from "@/lib/setup";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  if (await isSetupCompleted()) {
    redirect("/dashboard");
  }
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Welcome to Korepush</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Create your admin account to finish installing Korepush.
          </p>
        </div>
        <SetupForm />
      </div>
    </main>
  );
}
