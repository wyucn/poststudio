import { redirect } from "next/navigation";
import { isCasMode } from "@/lib/auth/cas";
import { LocalLoginPage } from "./local-login-page";

export default function LoginPage() {
  if (isCasMode()) redirect("/");
  return <LocalLoginPage />;
}
