import Avatar from "@mui/material/Avatar";
import { securityColor, securityInitials } from "./security-logo";

/** 32px round Security logo; falls back to initials on a name-derived color. Decorative. */
export function SecurityLogo({ name }: { name: string }) {
  return (
    <Avatar
      aria-hidden
      sx={{ width: 32, height: 32, fontSize: 13, fontWeight: 600, bgcolor: securityColor(name), color: "#FFFFFF", flexShrink: 0 }}
    >
      {securityInitials(name)}
    </Avatar>
  );
}
