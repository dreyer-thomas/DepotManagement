import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { DepotList } from "@/app/_components/depots/DepotList";
import { PageTitle } from "@/app/_components/Placeholder";
import { listDepots } from "@/modules/ledger";

export const metadata: Metadata = { title: "Einstellungen" };

export default async function SettingsPage() {
  const depots = await listDepots();
  return (
    <>
      <PageTitle>Einstellungen</PageTitle>
      <Box component="section" aria-labelledby="settings-depots">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2 }}>
          <Typography id="settings-depots" component="h2" variant="h6" sx={{ fontWeight: 600 }}>
            Depots
          </Typography>
          <CreateDepotButton variant="outlined" />
        </Box>
        {depots.length === 0 ? (
          <Card>
            <CardContent>
              <Typography>Noch kein Depot.</Typography>
            </CardContent>
          </Card>
        ) : (
          <DepotList depots={depots} renamable />
        )}
      </Box>
    </>
  );
}
