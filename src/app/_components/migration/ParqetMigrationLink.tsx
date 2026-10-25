"use client";

import Button, { type ButtonProps } from "@mui/material/Button";
import NextLink from "next/link";

/** Button-styled link to the Parqet migration wizard (server components cannot pass `NextLink` as a prop). */
export function ParqetMigrationLink({ variant = "outlined" }: { variant?: ButtonProps["variant"] }) {
  return (
    <Button component={NextLink} href="/settings/parqet" variant={variant} sx={{ minHeight: 44 }}>
      Aus Parqet übernehmen
    </Button>
  );
}
