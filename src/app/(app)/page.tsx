import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { DepotList } from "@/app/_components/depots/DepotList";
import { PageTitle } from "@/app/_components/Placeholder";
import { listDepots } from "@/modules/ledger";

export const metadata: Metadata = { title: "Übersicht" };

export default async function OverviewPage() {
  const depots = await listDepots();
  if (depots.length === 0) {
    return (
      <>
        <PageTitle>Übersicht</PageTitle>
        <Card>
          <CardContent>
            <Typography sx={{ mb: 2 }}>Noch kein Depot.</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <CreateDepotButton label="Depot anlegen" />
              {/* Enabled by the Parqet migration (Epic 2). */}
              <Button variant="outlined" disabled sx={{ minHeight: 44 }}>
                Aus Parqet übernehmen
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageTitle>Übersicht</PageTitle>
      <DepotList depots={depots} />
    </>
  );
}
