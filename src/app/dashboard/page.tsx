import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { casLoginUrl, isCasMode } from "@/lib/auth/cas";
import { AppHeader } from "@/components/app-header";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) {
    if (isCasMode()) {
      redirect(casLoginUrl(`${process.env.AUTH_URL ?? ""}/dashboard`));
    }
    redirect("/login");
  }

  return (
    <>
      <AppHeader
        userName={user.name}
        isAdmin={user.role === "admin"}
        casMode={isCasMode()}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <DashboardClient isAdmin={user.role === "admin"} />
      </main>
    </>
  );
}
