import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/** Page title in the `pageTitle` role. */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <Typography variant="pageTitle" component="h1" sx={{ mb: 2 }}>
      {children}
    </Typography>
  );
}

/** Neutral stand-in for surfaces built by later stories. */
export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageTitle>{title}</PageTitle>
      <Card>
        <CardContent>
          <Typography color="text.secondary">Dieser Bereich folgt in einer späteren Version.</Typography>
        </CardContent>
      </Card>
    </>
  );
}
