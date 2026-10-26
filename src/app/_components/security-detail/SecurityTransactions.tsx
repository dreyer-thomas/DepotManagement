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
import { QuantityText } from "@/app/_components/transactions/TransactionList";
import { TransactionTypeLabel } from "@/app/_components/transactions/TransactionType";
import { eventValue } from "@/app/_components/transactions/transaction-form";
import type { Split } from "@/core/corporate-actions";
import { formatDate, formatMoney } from "@/core/format";
import type { SecurityTransactionRecord, SplitRecord } from "@/modules/ledger";

const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

/**
 * "Buchungen": the scope's Transactions of the Security chain as given (newest first), read-only: Datum,
 * Art, Depot, Stück (split-adjusted as of `today`), Betrag. A row of another chain Security names it
 * under the type.
 */
export function SecurityTransactions({
  securityId,
  transactions,
  splits,
  today,
}: {
  /** The page's Security; rows of other chain Securities get a caption. */
  securityId: string;
  transactions: readonly SecurityTransactionRecord[];
  splits: readonly SplitRecord[];
  today: string;
}) {
  const coreSplits: Split[] = splits.map((split) => ({
    securityId: split.security.id,
    date: split.date,
    ratioOld: split.ratioOld,
    ratioNew: split.ratioNew,
  }));
  return (
    <Card component="section" aria-labelledby="security-transactions" sx={{ mb: 2, minWidth: 0 }}>
      <CardContent>
        <CardHeading id="security-transactions">Buchungen</CardHeading>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" aria-labelledby="security-transactions">
            <TableHead>
              <TableRow>
                <TableCell>Datum</TableCell>
                <TableCell>Art</TableCell>
                <TableCell>Depot</TableCell>
                <TableCell sx={numeric}>Stück</TableCell>
                <TableCell sx={numeric}>Betrag</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(transaction.date)}</TableCell>
                  <TableCell>
                    <TransactionTypeLabel type={transaction.type} />
                    {transaction.security && transaction.security.id !== securityId ? (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {transaction.security.name}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{transaction.depotName}</TableCell>
                  <TableCell sx={numeric}>
                    <QuantityText transaction={transaction} splits={coreSplits} today={today} />
                  </TableCell>
                  <TableCell sx={numeric}>{formatMoney(eventValue(transaction))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </CardContent>
    </Card>
  );
}
