"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ensureCurrentEntry, installHistoryTracking } from "./history-tracker";

/**
 * Mounted once in the app shell: installs the history wrappers, which record every push and replace
 * (pathname and search) into this tab's store, and makes sure the entry shown has an id (first load,
 * new tab, a navigation before the wrappers were installed).
 */
export function HistoryTracker() {
  const pathname = usePathname();
  useEffect(() => {
    installHistoryTracking();
    ensureCurrentEntry();
  }, [pathname]);
  return null;
}
