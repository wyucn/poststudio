import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { casLoginUrl, isCasMode } from "@/lib/auth/cas";
import { Workspace } from "@/components/workspace/workspace";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    if (isCasMode()) {
      redirect(casLoginUrl(`${process.env.AUTH_URL ?? ""}/projects/${id}`));
    }
    redirect("/login");
  }

  return (
    <main className="workspace-page h-dvh min-h-0 overflow-hidden">
      <Workspace
        projectId={id}
        userId={user.id}
        userName={user.name}
        isAdmin={user.role === "admin"}
        casMode={isCasMode()}
      />
    </main>
  );
}
