import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brokerLabel } from "@/app/_components/depots/labels";
import { PageTitle } from "@/app/_components/Placeholder";
import { formatMoney } from "@/core/format";
import { getDepot } from "@/modules/ledger";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const depot = await getDepot((await params).id);
  return { title: depot ? depot.name : "Depot nicht gefunden" };
}

export default async function DepotDetailPage({ params }: Props) {
  const depot = await getDepot((await params).id);
  if (!depot) notFound();
  return (
    <>
      <PageTitle>{depot.name}</PageTitle>
      <Stack direction="row" spacing={3} sx={{ mb: 2, flexWrap: "wrap" }}>
        <Typography color="text.secondary">{brokerLabel(depot.broker)}</Typography>
        <Typography>
          Cash-Konto <Typography component="span" variant="figure">{formatMoney(depot.cashBalance)}</Typography>
        </Typography>
      </Stack>
      <Card>
        <CardContent>
          <Typography sx={{ mb: 2 }}>Noch keine Buchungen.</Typography>
          {/* Enabled by story 1.4 (record buys and sells). */}
          <Button variant="contained" disabled sx={{ minHeight: 44 }}>
            Neue Buchung
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
