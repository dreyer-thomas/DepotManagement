import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { ParqetMigrationWizard } from "@/app/_components/migration/ParqetMigrationWizard";
import { PageTitle } from "@/app/_components/Placeholder";
import { listDepots } from "@/modules/ledger";

export const metadata: Metadata = { title: "Aus Parqet übernehmen" };

export default async function ParqetMigrationPage() {
  // Archived Depots are read-only (AD-17) and cannot be a migration target.
  const depots = (await listDepots()).filter((depot) => !depot.archived).map(({ id, name }) => ({ id, name }));
  return (
    <>
      <PageTitle>Aus Parqet übernehmen</PageTitle>
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
