import { redirect } from "next/navigation";
import { isSetupCompleted } from "@/lib/setup";
import { getSession } from "@/lib/session";

export default async function RootPage() {
  if (!(await isSetupCompleted())) {
    redirect("/setup");
  }
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  redirect("/dashboard");
}
