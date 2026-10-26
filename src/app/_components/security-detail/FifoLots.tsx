import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { CardHeading } from "@/app/_components/overview/CardHeading";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type { SecurityLot } from "@/core/security";
import { NO_LOTS_TEXT } from "./labels";

const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

/** "Offene Kaufposten": per Depot with open FIFO lots a table (Kaufdatum, Stück, Cost Basis, Einstandskurs). */
export function FifoLots({ groups }: { groups: readonly { depotId: string; depotName: string; lots: readonly SecurityLot[] }[] }) {
  return (
    <Card component="section" aria-labelledby="security-lots" sx={{ mb: 2, minWidth: 0 }}>
      <CardContent>
        <CardHeading id="security-lots">Offene Kaufposten</CardHeading>
        {groups.length === 0 ? (
          <Typography variant="body2">{NO_LOTS_TEXT}</Typography>
        ) : (
          groups.map((group) => {
            const headingId = `security-lots-${group.depotId}`;
            return (
              <Box key={group.depotId} sx={{ "& + &": { mt: 2 } }}>
                <Typography id={headingId} component="h3" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {group.depotName}
                </Typography>
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small" aria-labelledby={headingId}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Kaufdatum</TableCell>
                        <TableCell sx={numeric}>Stück</TableCell>
                        <TableCell sx={numeric}>Cost Basis</TableCell>
                        <TableCell sx={numeric}>Einstandskurs</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.lots.map((lot) => (
                        <TableRow key={`${lot.date}-${lot.sequence}`}>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(lot.date)}</TableCell>
                          <TableCell sx={numeric}>{formatQuantity(lot.quantity)}</TableCell>
                          <TableCell sx={numeric}>{formatMoney(lot.costBasis)}</TableCell>
                          <TableCell sx={numeric}>{formatMoney(lot.price)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
