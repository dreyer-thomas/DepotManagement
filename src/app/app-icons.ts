// Home-screen app icons (story 8-1): single source for the manifest, the root layout and the test
// that cross-checks the auth proxy's public paths. The proxy matcher must stay a static literal for
// Next, so `src/proxy.ts` repeats these four paths instead of importing them.

export type AppIcon = {
  src: string;
  size: number;
  purpose: "any" | "maskable";
};

export const APP_ICONS = [
  { src: "/icons/icon-192.png", size: 192, purpose: "any" },
  { src: "/icons/icon-512.png", size: 512, purpose: "any" },
  { src: "/icons/icon-maskable-512.png", size: 512, purpose: "maskable" },
] as const satisfies readonly AppIcon[];

export const APPLE_TOUCH_ICON = { src: "/icons/apple-touch-icon.png", size: 180 } as const;

/** Every icon path the proxy must serve without a session. */
export const PUBLIC_ICON_PATHS: readonly string[] = [...APP_ICONS.map((icon) => icon.src), APPLE_TOUCH_ICON.src];
