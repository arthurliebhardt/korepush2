import { redirect } from "next/navigation";

export default function SettingsRoot() {
  redirect("/dashboard/settings/integrations");
}
