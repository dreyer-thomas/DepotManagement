"use client";

import Avatar from "@mui/material/Avatar";
import { useState } from "react";
import { useLogoVersion } from "./LogoContext";
import { securityColor, securityInitials } from "./security-logo";

/** URL of a Security's stored logo, served by the app (never a provider URL). */
export function logoUrl(securityId: string, version: string): string {
  return `/api/logos/${encodeURIComponent(securityId)}?v=${encodeURIComponent(version)}`;
}

/**
 * 32px round Security logo. With a stored logo it shows the image from the app's own route and keeps the
 * initials as fallback content (shown if the image fails); without one, the initials on a name-derived
 * color render immediately in the same box. Decorative.
 */
export function SecurityLogo({ securityId, name }: { securityId: string; name: string }) {
  const version = useLogoVersion(securityId);
  // The URL whose image failed to load; a new version (upload) gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = version !== undefined ? logoUrl(securityId, version) : undefined;
  const src = url !== failedUrl ? url : undefined;
  return (
    <Avatar
      aria-hidden
      alt=""
      src={src}
      slotProps={{ img: { onError: () => setFailedUrl(url), loading: "lazy" } }}
      sx={{
        width: 32,
        height: 32,
        fontSize: 13,
        fontWeight: 600,
        // The name color stays on the Avatar so fallback initials are always readable; the image itself
        // sits on white.
        bgcolor: securityColor(name),
        color: "#FFFFFF",
        flexShrink: 0,
        "& img": { objectFit: "contain", bgcolor: "#FFFFFF" },
      }}
    >
      {securityInitials(name)}
    </Avatar>
  );
}
