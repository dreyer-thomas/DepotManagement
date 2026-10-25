import SellOutlined from "@mui/icons-material/SellOutlined";
import ShoppingCartOutlined from "@mui/icons-material/ShoppingCartOutlined";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { formatDate, formatMoney, formatMonth, formatQuantity } from "@/core/format";
import type { TransactionRecord } from "@/modules/ledger";
import { SecurityLogo } from "../securities/SecurityLogo";
import { transactionTypeLabel } from "./labels";

type MonthGroup = { key: string; label: string; transactions: TransactionRecord[] };

/** Groups an already newest-first list by month (`YYYY-MM`), keeping the order. */
function groupByMonth(transactions: TransactionRecord[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const transaction of transactions) {
    const key = transaction.date.slice(0, 7);
    const last = groups.at(-1);
    if (last && last.key === key) last.transactions.push(transaction);
    else groups.push({ key, label: formatMonth(transaction.date), transactions: [transaction] });
  }
  return groups;
}

function TypeCell({ type }: { type: TransactionRecord["type"] }) {
  const Icon = type === "SELL" ? SellOutlined : ShoppingCartOutlined;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Icon fontSize="small" aria-hidden color={type === "SELL" ? "secondary" : "primary"} />
      <span>{transactionTypeLabel(type)}</span>
    </Stack>
  );
}

const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

/** Transactions grouped by month (newest first) as semantic tables. */
export function TransactionList({ transactions }: { transactions: TransactionRecord[] }) {
  return (
    <Stack spacing={3}>
      {groupByMonth(transactions).map((group) => {
        const headingId = `transactions-month-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId}>
            <Typography id={headingId} component="h2" variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {group.label}
            </Typography>
            <Card sx={{ overflowX: "auto" }}>
              <Table size="small" aria-labelledby={headingId}>
                <TableHead>
                  <TableRow>
                    <TableCell>Art</TableCell>
                    <TableCell>Security</TableCell>
                    <TableCell>Datum</TableCell>
                    <TableCell sx={numeric}>Stück</TableCell>
                    <TableCell sx={numeric}>Betrag</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.transactions.map((transaction) => {
                    const name = transaction.security?.name ?? "";
                    return (
                      <TableRow key={transaction.id} sx={{ "& td": { py: 1 } }}>
                        <TableCell>
                          <TypeCell type={transaction.type} />
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 160 }}>
                            <SecurityLogo name={name} />
                            <span>{name}</span>
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(transaction.date)}</TableCell>
                        <TableCell sx={numeric}>
                          {transaction.quantity ? `${formatQuantity(transaction.quantity)} Stück` : ""}
                        </TableCell>
                        <TableCell sx={numeric}>{formatMoney(transaction.amount)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </section>
        );
      })}
    </Stack>
  );
}
