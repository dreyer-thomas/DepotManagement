import CssBaseline from "@mui/material/CssBaseline";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import type { ReactNode } from "react";
import { theme } from "@/theme/theme";
import { colors } from "@/theme/tokens";
import { APP_ICONS, APPLE_TOUCH_ICON } from "./app-icons";

// Self-hosted by next/font at build time; the browser never calls Google Fonts.
const roboto = Roboto({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: { default: "DepotManagement", template: "%s · DepotManagement" },
  description: "Selbst gehostete Depotverwaltung",
  // Home-screen app (story 8-1); the manifest link comes from app/manifest.ts.
  icons: {
    icon: { url: APP_ICONS[0].src, sizes: `${APP_ICONS[0].size}x${APP_ICONS[0].size}`, type: "image/png" },
    apple: { url: APPLE_TOUCH_ICON.src, sizes: `${APPLE_TOUCH_ICON.size}x${APPLE_TOUCH_ICON.size}` },
  },
  appleWebApp: { capable: true, title: "Depot", statusBarStyle: "default" },
  // Next 16 renders `capable` as the standard `mobile-web-app-capable`; older iOS reads only the Apple name.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Status bar follows the OS scheme in the AppBar colour (surface); the in-app Hell/Dunkel override does not.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: colors.surface },
    { media: "(prefers-color-scheme: dark)", color: colors["surface-dark"] },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={roboto.variable} suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="system" />
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme} defaultMode="system">
            <CssBaseline enableColorScheme />
            {children}
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
