"use client";

import FileUploadOutlined from "@mui/icons-material/FileUploadOutlined";
import Button from "@mui/material/Button";
import NextLink from "next/link";
import { ResponsiveLabel } from "../ResponsiveLabel";

/** "Dokumente importieren" ("Dokument" on phones): opens `/import` with Depot `depotId` preselected. */
export function ImportDocumentsLink({ depotId }: { depotId: string }) {
  return (
    <Button
      component={NextLink}
      href={`/import?depot=${encodeURIComponent(depotId)}`}
      variant="outlined"
      startIcon={<FileUploadOutlined />}
      aria-label="Dokumente importieren"
      sx={{ minHeight: 44 }}
    >
      <ResponsiveLabel full="Dokumente importieren" short="Dokument" />
    </Button>
  );
}
