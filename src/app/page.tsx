import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { casLoginUrl, isCasMode } from "@/lib/auth/cas";
import { ensureDefaultProject } from "@/lib/projects/default-project";

export default async function Home() {
  const user = await getSessionUser();
  if (user) {
    const project = ensureDefaultProject(user);
    redirect(`/projects/${project.id}`);
  }
  if (isCasMode()) {
    redirect(casLoginUrl(`${process.env.AUTH_URL ?? ""}/`));
  }
  redirect("/login");
}
