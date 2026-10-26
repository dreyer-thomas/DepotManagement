import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { formatDate, formatMoney } from "@/core/format";
import type { CashBookingRecord } from "@/modules/ledger";
import { SecurityLogo } from "../securities/SecurityLogo";
import { CashEffectText, TransactionTypeLabel } from "../transactions/TransactionType";

const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

/** Cash Account: current balance ("Saldo", as of today) and the booking history, newest first. */
export function CashBookings({ balance, bookings }: { balance: string; bookings: CashBookingRecord[] }) {
  return (
    <Stack spacing={2}>
      <Card sx={{ borderLeft: 4, borderColor: "cash.main" }}>
        <CardContent sx={{ "&:last-child": { pb: 2 } }}>
          <Typography variant="body2" color="text.secondary">
            Saldo
          </Typography>
          <Typography variant="figureHero" component="p">
            {formatMoney(balance)}
          </Typography>
        </CardContent>
      </Card>
      <Card sx={{ overflowX: "auto" }}>
        <Table size="small" aria-label="Cash-Konto Buchungen">
          <TableHead>
            <TableRow>
              <TableCell>Datum</TableCell>
              <TableCell>Art</TableCell>
              <TableCell>Security</TableCell>
              <TableCell sx={numeric}>Cash-Effekt</TableCell>
              <TableCell sx={numeric}>Saldo</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bookings.map((booking) => (
              <TableRow key={booking.id} sx={{ "& td": { py: 1 } }}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(booking.date)}</TableCell>
                <TableCell>
                  <TransactionTypeLabel type={booking.type} />
                </TableCell>
                <TableCell>
                  {booking.security ? (
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 160 }}>
                      <SecurityLogo securityId={booking.security.id} name={booking.security.name} />
                      <span>{booking.security.name}</span>
                    </Stack>
                  ) : null}
                </TableCell>
                <TableCell sx={numeric}>
                  <CashEffectText value={booking.cashEffect} />
                </TableCell>
                <TableCell sx={numeric}>{formatMoney(booking.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Stack>
  );
}
