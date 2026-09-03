import { redirect } from "next/navigation";
import { isCasMode } from "@/lib/auth/cas";
import { LocalRegisterPage } from "./local-register-page";

export default function RegisterPage() {
  if (isCasMode()) redirect("/");
  return <LocalRegisterPage />;
}
