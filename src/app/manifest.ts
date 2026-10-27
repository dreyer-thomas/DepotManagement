import type { MetadataRoute } from "next";
import { colors } from "@/theme/tokens";
import { APP_ICONS } from "./app-icons";

// Served by Next at /manifest.webmanifest and linked from every page's head (story 8-1).
// No service worker: the installed app is a full-screen window on the live server.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DepotManagement",
    short_name: "Depot",
    description: "Selbst gehostete Depotverwaltung",
    lang: "de",
    start_url: "/",
    display: "standalone",
    background_color: colors.background,
    theme_color: colors.surface,
    icons: APP_ICONS.map((icon) => ({
      src: icon.src,
      sizes: `${icon.size}x${icon.size}`,
      type: "image/png",
      purpose: icon.purpose,
    })),
  };
}
