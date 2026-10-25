import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/modules/auth";
import { AppShell } from "../_components/AppShell";

// Every page in this group needs a session. The proxy is the first gate; this re-check keeps a
// matcher mistake from exposing a page.
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}
