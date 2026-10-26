"use client";

import { createContext, type ReactNode, useContext } from "react";

/** Cache-busting version per Security id with a stored logo (`listLogoVersions`); absent ids have none. */
const LogoVersionsContext = createContext<Record<string, string>>({});

/** Makes the stored-logo versions available to every `SecurityLogo` below it. */
export function LogoProvider({ versions, children }: { versions: Record<string, string>; children: ReactNode }) {
  return <LogoVersionsContext.Provider value={versions}>{children}</LogoVersionsContext.Provider>;
}

/** The version of the Security's stored logo, or `undefined` when it has none. */
export function useLogoVersion(securityId: string): string | undefined {
  const versions = useContext(LogoVersionsContext);
  return Object.hasOwn(versions, securityId) ? versions[securityId] : undefined;
}
