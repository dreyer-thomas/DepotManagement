import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { ExportButton } from "@/app/_components/backup/ExportButton";
import { RestoreButton } from "@/app/_components/backup/RestoreButton";
import { backupFailedWarning, lastBackupLine } from "@/app/_components/backup/labels";
import { CreateDepotButton } from "@/app/_components/depots/DepotDialogs";
import { DepotGroups } from "@/app/_components/depots/DepotList";
import { ParqetMigrationLink } from "@/app/_components/migration/ParqetMigrationLink";
import { PageTitle } from "@/app/_components/Placeholder";
import { AllowanceForm } from "@/app/_components/tax/AllowanceForm";
import { formatDateTime } from "@/core/format";
import { businessDate } from "@/core/dates";
import { backupStatus } from "@/modules/backup";
import { firstLedgerDate, listDepots } from "@/modules/ledger";
import { listTaxAllowances } from "@/modules/tax";

export const metadata: Metadata = { title: "Einstellungen" };

export default async function SettingsPage() {
  const [depots, allowances, firstDate] = await Promise.all([listDepots(), listTaxAllowances(), firstLedgerDate()]);
  const todayYear = Number(businessDate(new Date()).slice(0, 4));
  const backup = backupStatus();
  const lastBackup = backup.lastSuccessAt ? formatDateTime(backup.lastSuccessAt) : null;
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
          <DepotGroups depots={depots} settings />
        )}
      </Box>
      <Box component="section" aria-labelledby="settings-parqet" sx={{ mt: 4 }}>
        <Typography id="settings-parqet" component="h2" variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
          Parqet-Migration
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Übernimm die Buchungen eines Parqet-Portfolios aus dessen CSV-Export in ein Depot.
        </Typography>
        <ParqetMigrationLink />
      </Box>
      <Box component="section" aria-labelledby="settings-tax" sx={{ mt: 4 }}>
        <Typography id="settings-tax" component="h2" variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
          Steuern
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Trage je Broker und Jahr deinen Freistellungsauftrag ein. Analysen › Steuern nutzt ihn für die
          Steuerschätzung; ein leeres Feld zählt als 0 €.
        </Typography>
        {depots.length === 0 ? (
          <Card>
            <CardContent>
              <Typography>Noch kein Depot.</Typography>
            </CardContent>
          </Card>
        ) : (
          <AllowanceForm
            allowances={allowances}
            firstYear={firstDate ? Number(firstDate.slice(0, 4)) : todayYear}
            todayYear={todayYear}
          />
        )}
      </Box>
      <Box component="section" aria-labelledby="settings-backup" sx={{ mt: 4 }}>
        <Typography id="settings-backup" component="h2" variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
          Datensicherung
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Lade alle Daten als JSON-Datei herunter: Depots, Buchungen, Kurse, hochgeladene Logos, Freistellungsaufträge, Teilfreistellungen und Zielallokationen. Aus einer
          solchen Datei kannst du alle Daten wiederherstellen; dabei werden die vorhandenen Daten ersetzt.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
          <ExportButton />
          <RestoreButton />
        </Stack>
        {backup.lastAttemptFailed ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {backupFailedWarning(lastBackup)}
          </Alert>
        ) : lastBackup ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {lastBackupLine(lastBackup)}
          </Typography>
        ) : null}
      </Box>
    </>
  );
}
