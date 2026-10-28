import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { BackLink } from "@/app/_components/back-navigation/BackLink";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { ParqetMigrationWizard } from "@/app/_components/migration/ParqetMigrationWizard";
import { listDepots } from "@/modules/ledger";

export const metadata: Metadata = { title: "Aus Parqet übernehmen" };

export default async function ParqetMigrationPage() {
  // Archived Depots are read-only (AD-17) and cannot be a migration target.
  const depots = (await listDepots()).filter((depot) => !depot.archived).map(({ id, name }) => ({ id, name }));
  return (
    <>
      <BackLink parent={{ href: "/settings", label: "Einstellungen" }} self="Aus Parqet übernehmen" />
      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center", minWidth: 0 }}>
        <Typography variant="pageTitle" component="h1">
          Aus Parqet übernehmen
        </Typography>
      </Stack>
      {depots.length === 0 ? (
        <Card>
          <CardContent>
            <Typography sx={{ mb: 2 }}>Lege zuerst ein Depot an.</Typography>
            <CreateDepotButton />
          </CardContent>
        </Card>
      ) : (
        <ParqetMigrationWizard depots={depots} />
      )}
    </>
  );
}
