"use client";

import FileUploadOutlined from "@mui/icons-material/FileUploadOutlined";
import Button from "@mui/material/Button";
import NextLink from "next/link";

/** "Dokumente importieren": opens `/import` with Depot `depotId` preselected. */
export function ImportDocumentsLink({ depotId }: { depotId: string }) {
  return (
    <Button
      component={NextLink}
      href={`/import?depot=${encodeURIComponent(depotId)}`}
      variant="outlined"
      startIcon={<FileUploadOutlined />}
      sx={{ minHeight: 44 }}
    >
      Dokumente importieren
    </Button>
  );
}
