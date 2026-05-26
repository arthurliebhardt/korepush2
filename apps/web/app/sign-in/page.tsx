import { redirect } from "next/navigation";
import { isSetupCompleted } from "@/lib/setup";
import { getSession } from "@/lib/session";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  if (!(await isSetupCompleted())) redirect("/setup");
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Sign in</h1>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}
