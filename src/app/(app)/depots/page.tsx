import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { DepotGroups } from "@/app/_components/depots/DepotList";
import { PageTitle } from "@/app/_components/Placeholder";
import { listDepots } from "@/modules/ledger";

export const metadata: Metadata = { title: "Depots" };

export default async function DepotsPage() {
  const depots = await listDepots();
  return (
    <>
      <PageTitle>Depots</PageTitle>
      <Box sx={{ mb: 2 }}>
        <CreateDepotButton />
      </Box>
      {depots.length === 0 ? (
        <Card>
          <CardContent>
            <Typography>Noch kein Depot.</Typography>
          </CardContent>
        </Card>
      ) : (
        <DepotGroups depots={depots} />
      )}
    </>
  );
}
