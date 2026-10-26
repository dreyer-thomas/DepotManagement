import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";

function CardSkeleton({ lines }: { lines: number }) {
  return (
    <Card sx={{ minWidth: 0 }}>
      <CardContent>
        <Skeleton variant="text" width={120} />
        {Array.from({ length: lines }, (_, index) => (
          <Stack key={index} direction="row" spacing={1.5} sx={{ alignItems: "center", py: 1 }}>
            <Skeleton variant="circular" width={32} height={32} />
            <Skeleton variant="text" sx={{ flex: 1 }} />
            <Skeleton variant="text" width={80} />
          </Stack>
        ))}
      </CardContent>
    </Card>
  );
}

/** Skeleton of the Overview in its layout: header, hero, KPI row, two cards and the Depots card. */
export function OverviewSkeleton() {
  return (
    <Box role="status" aria-busy="true" aria-label="Übersicht wird geladen">
      <Stack direction="row" sx={{ mb: 2, alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Skeleton variant="text" width={140} height={36} />
        <Skeleton variant="rounded" width={280} height={36} sx={{ borderRadius: 999, display: { xs: "none", sm: "block" } }} />
      </Stack>
      <Card sx={{ mb: 1.5 }}>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Skeleton variant="text" width={90} />
          <Skeleton variant="text" width={220} height={48} />
          <Skeleton variant="rounded" width={240} height={26} sx={{ borderRadius: 999, mt: 1 }} />
          <Skeleton variant="rounded" height={200} sx={{ mt: 1.5 }} />
        </CardContent>
      </Card>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
          gap: 1.5,
          mb: 2,
        }}
      >
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index}>
            <CardContent>
              <Skeleton variant="text" width="70%" />
              <Skeleton variant="text" width="50%" height={28} />
            </CardContent>
          </Card>
        ))}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1.5fr) minmax(0, 1fr)" }, gap: 1.5, mb: 2 }}>
        <CardSkeleton lines={5} />
        <CardSkeleton lines={3} />
      </Box>
      <CardSkeleton lines={3} />
    </Box>
  );
}
