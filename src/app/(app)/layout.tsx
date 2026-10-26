import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/modules/auth";
import { listLogoVersions } from "@/modules/logos";
import { AppShell } from "../_components/AppShell";
import { LogoProvider } from "../_components/securities/LogoContext";
import { openImportCount } from "./open-imports";

/** Stored-logo versions for `SecurityLogo`; a read failure only means initials everywhere. */
async function logoVersions(): Promise<Record<string, string>> {
  try {
    return await listLogoVersions();
  } catch (error) {
    console.error(`Logos: listing logo versions failed (${error instanceof Error ? error.name : "unknown"})`);
    return {};
  }
}

// Every page in this group needs a session. The proxy is the first gate; this re-check keeps a
// matcher mistake from exposing a page.
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const [versions, openImports] = await Promise.all([logoVersions(), openImportCount()]);
  return (
    <LogoProvider versions={versions}>
      <AppShell openImports={openImports}>{children}</AppShell>
    </LogoProvider>
  );
}
