import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { casLoginUrl, isCasMode } from "@/lib/auth/cas";
import { AppHeader } from "@/components/app-header";
import { ProjectsClient } from "./projects-client";

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) {
    if (isCasMode()) {
      redirect(casLoginUrl(`${process.env.AUTH_URL ?? ""}/projects`));
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
        <ProjectsClient />
      </main>
    </>
  );
}
