import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getSessionUser } from "@/lib/auth/session";
import { casLoginUrl, isCasMode } from "@/lib/auth/cas";
import { ModelConfigClient } from "./model-config-client";

export default async function ModelConfigPage() {
  const user = await getSessionUser();
  if (!user) {
    if (isCasMode()) {
      redirect(casLoginUrl(`${process.env.AUTH_URL ?? ""}/dashboard/models`));
    }
    redirect("/login");
  }
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <>
      <AppHeader userName={user.name} isAdmin casMode={isCasMode()} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <ModelConfigClient />
      </main>
    </>
  );
}
