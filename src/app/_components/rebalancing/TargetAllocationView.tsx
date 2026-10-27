"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useId } from "react";
import { formatMoney, formatQuantity, formatShare } from "@/core/format";
import type { RebalancingResult, Targets } from "@/core/rebalancing";
import { CardHeading } from "../overview/CardHeading";
import {
  ACTUAL_HEADING,
  ALSO_SOLD_HINT,
  CASH_SALE,
  cashLeftText,
  DEPOSIT_INVALID,
  DEPOSIT_LABEL,
  IN_RANGE_LABEL,
  instrumentText,
  NO_TARGETS_TEXT,
  percentText,
  pointsText,
  PROPOSAL_HEADING,
  PROPOSAL_HINT,
  SEGMENT_LABELS,
  signedMoney,
  TARGETS_HEADING,
  TOTAL_LABEL,
  UNASSIGNED_HINT,
  UNASSIGNED_LABEL,
} from "./labels";
import { TargetForm } from "./TargetForm";

const CONTROL = { minHeight: 44 } as const;
const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const MISSING = "–";

export type TargetAllocationViewProps = {
  /** `portfolio` or a Depot id. */
  scope: string;
  result: RebalancingResult;
  /** The scope's stored targets; null when none are stored. */
  allocation: { targets: Targets; threshold: string } | null;
  securityNames: Readonly<Record<string, string>>;
  depotNames: Readonly<Record<string, string>>;
  /** The `?deposit=` input as entered, and whether it was invalid (then 0 is used). */
  depositText: string;
  depositInvalid: boolean;
};

function InRangeChip() {
  return <Chip size="small" variant="outlined" label={IN_RANGE_LABEL} sx={{ ml: 1 }} />;
}

/** The segment table: actual € and %, target %, deviation in points and €, "Nicht zugeordnet" and "Summe". */
function ActualTable({ result, securityNames, depotNames, headingId }: Pick<TargetAllocationViewProps, "result" | "securityNames" | "depotNames"> & { headingId: string }) {
  const showUnassigned = result.unassigned.value !== "0";
  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small" aria-labelledby={headingId}>
        <TableHead>
          <TableRow>
            <TableCell>Segment</TableCell>
            <TableCell sx={numeric}>Ist</TableCell>
            <TableCell sx={numeric}>Ist %</TableCell>
            <TableCell sx={numeric}>Ziel %</TableCell>
            <TableCell sx={numeric}>Abweichung (Pkt.)</TableCell>
            <TableCell sx={numeric}>Abweichung (€)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {result.segments.map((row) => (
            <TableRow key={row.segment}>
              <TableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
                {SEGMENT_LABELS[row.segment]}
                {row.inRange ? <InRangeChip /> : null}
              </TableCell>
              <TableCell sx={numeric}>{formatMoney(row.value)}</TableCell>
              <TableCell sx={numeric}>{row.share === null ? MISSING : formatShare(row.share)}</TableCell>
              <TableCell sx={numeric}>{row.target === null ? MISSING : percentText(row.target)}</TableCell>
              <TableCell sx={numeric}>{row.deviationPoints === null ? MISSING : pointsText(row.deviationPoints)}</TableCell>
              <TableCell sx={numeric}>{row.deviationAmount === null ? MISSING : signedMoney(row.deviationAmount)}</TableCell>
            </TableRow>
          ))}
          {showUnassigned ? (
            <TableRow>
              <TableCell component="th" scope="row">
                {UNASSIGNED_LABEL}
                <Typography variant="caption" color="text.secondary" component="p">
                  {UNASSIGNED_HINT}
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {result.unassigned.holdings.map((holding) => (
                    <Typography key={`${holding.depotId}|${holding.securityId}`} component="li" variant="caption" sx={{ overflowWrap: "anywhere" }}>
                      {`${securityNames[holding.securityId] ?? holding.securityId} (${depotNames[holding.depotId] ?? holding.depotId}): ${formatMoney(holding.value)}`}
                    </Typography>
                  ))}
                </Box>
              </TableCell>
              <TableCell sx={{ ...numeric, verticalAlign: "top" }}>{formatMoney(result.unassigned.value)}</TableCell>
              <TableCell colSpan={4} />
            </TableRow>
          ) : null}
          <TableRow>
            <TableCell component="th" scope="row" sx={{ fontWeight: 600 }}>
              {TOTAL_LABEL}
            </TableCell>
            <TableCell sx={{ ...numeric, fontWeight: 600 }}>{formatMoney(result.total)}</TableCell>
            <TableCell colSpan={4} />
          </TableRow>
        </TableBody>
      </Table>
    </Box>
  );
}

/** "Neue Einzahlung": a GET form that keeps the tab and scope and recomputes the proposal. */
function DepositForm({ scope, depositText, depositInvalid }: Pick<TargetAllocationViewProps, "scope" | "depositText" | "depositInvalid">) {
  return (
    <Box component="form" method="get" action="/analyses" sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "flex-start" }}>
      <input type="hidden" name="tab" value="targets" />
      <input type="hidden" name="scope" value={scope} />
      <TextField
        name="deposit"
        label={DEPOSIT_LABEL}
        defaultValue={depositText}
        error={depositInvalid}
        helperText={depositInvalid ? DEPOSIT_INVALID : undefined}
        placeholder="0"
        slotProps={{ htmlInput: { inputMode: "decimal" }, inputLabel: { shrink: true } }}
        sx={{ width: { xs: "100%", sm: 240 }, "& .MuiInputBase-root": CONTROL }}
      />
      <Button type="submit" variant="outlined" sx={CONTROL}>
        Berechnen
      </Button>
    </Box>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <Box role="row" sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.5 }}>
      <Typography component="span" role="rowheader" variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography component="span" role="cell" variant="body2" sx={{ ...numeric, fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}

function SubHeading({ id, children }: { id: string; children: string }) {
  return (
    <Typography id={id} component="h3" variant="body2" sx={{ fontWeight: 600, mt: 1 }}>
      {children}
    </Typography>
  );
}

/** The proposal: buys, sells (with estimated gain and tax), in-range segments and the totals. */
function Proposal({ result, securityNames, depotNames, ids }: Pick<TargetAllocationViewProps, "result" | "securityNames" | "depotNames"> & { ids: string }) {
  const proposal = result.proposal;
  if (!proposal) return null;
  const soldIds = new Set(proposal.sells.flatMap((sell) => (sell.securityId === null ? [] : [sell.securityId])));
  return (
    <Stack spacing={1.5}>
      <SubHeading id={`${ids}-buys`}>Käufe</SubHeading>
      {proposal.buys.length === 0 ? (
        <Typography variant="body2">Keine Käufe.</Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" aria-labelledby={`${ids}-buys`}>
            <TableHead>
              <TableRow>
                <TableCell>Segment</TableCell>
                <TableCell sx={numeric}>Betrag</TableCell>
                <TableCell>Instrument</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {proposal.buys.map((buy) => (
                <TableRow key={buy.segment}>
                  <TableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
                    {SEGMENT_LABELS[buy.segment]}
                  </TableCell>
                  <TableCell sx={numeric}>{formatMoney(buy.amount)}</TableCell>
                  <TableCell sx={{ overflowWrap: "anywhere" }}>
                    {instrumentText(buy.instrument, securityNames)}
                    {buy.instrument?.kind === "security" && soldIds.has(buy.instrument.securityId) ? (
                      <Typography variant="caption" color="text.secondary" component="p">
                        {ALSO_SOLD_HINT}
                      </Typography>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <SubHeading id={`${ids}-sells`}>Verkäufe</SubHeading>
      {proposal.sells.length === 0 ? (
        <Typography variant="body2">Keine Verkäufe.</Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" aria-labelledby={`${ids}-sells`}>
            <TableHead>
              <TableRow>
                <TableCell>Segment</TableCell>
                <TableCell>Wertpapier</TableCell>
                <TableCell>Depot</TableCell>
                <TableCell sx={numeric}>Stück</TableCell>
                <TableCell sx={numeric}>Betrag</TableCell>
                <TableCell sx={numeric}>geschätzter Gewinn</TableCell>
                <TableCell sx={numeric}>geschätzte Steuer</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {proposal.sells.map((sell, index) => (
                <TableRow key={index}>
                  <TableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
                    {SEGMENT_LABELS[sell.segment]}
                  </TableCell>
                  <TableCell sx={{ overflowWrap: "anywhere" }}>
                    {sell.securityId === null ? CASH_SALE : (securityNames[sell.securityId] ?? sell.securityId)}
                  </TableCell>
                  <TableCell sx={{ overflowWrap: "anywhere" }}>{depotNames[sell.depotId] ?? sell.depotId}</TableCell>
                  <TableCell sx={numeric}>{sell.quantity === null ? MISSING : formatQuantity(sell.quantity)}</TableCell>
                  <TableCell sx={numeric}>{formatMoney(sell.amount)}</TableCell>
                  <TableCell sx={numeric}>{signedMoney(sell.gain)}</TableCell>
                  <TableCell sx={numeric}>{signedMoney(sell.tax)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <SubHeading id={`${ids}-in-range`}>Im Rahmen</SubHeading>
      {proposal.inRange.length === 0 ? (
        <Typography variant="body2">Keine Segmente im Rahmen.</Typography>
      ) : (
        <Box component="ul" aria-labelledby={`${ids}-in-range`} sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 1 }}>
          {proposal.inRange.map((segment) => (
            <li key={segment}>
              <Chip size="small" variant="outlined" label={SEGMENT_LABELS[segment]} />
            </li>
          ))}
        </Box>
      )}

      <Box role="table" aria-label="Summen des Vorschlags" sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}>
        <Box role="rowgroup">
          {proposal.deposit !== "0" ? <Total label="Neue Einzahlung" value={formatMoney(proposal.deposit)} /> : null}
          <Total label="Käufe" value={formatMoney(proposal.totalBuys)} />
          <Total label="Verkäufe" value={formatMoney(proposal.totalSells)} />
          <Total label="geschätzte Steuer gesamt" value={signedMoney(proposal.totalTax)} />
          <Total label="Saldo Guthaben" value={cashLeftText(proposal.cashLeft)} />
        </Box>
      </Box>
    </Stack>
  );
}

/**
 * Analysen › Zielallokation (story 8.5): the target form of the scope, the segment table (actual vs target,
 * "im Rahmen" within the threshold, "Nicht zugeordnet", "Summe" = scope value) and the advisory
 * "Rebalancing-Vorschlag" with a "Neue Einzahlung". Everything is an estimate; nothing is booked.
 */
export function TargetAllocationView({ scope, result, allocation, securityNames, depotNames, depositText, depositInvalid }: TargetAllocationViewProps) {
  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <Stack spacing={2}>
      <Card component="section" aria-labelledby={`${ids}-targets`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-targets`}>{TARGETS_HEADING}</CardHeading>
          <TargetForm key={scope} scope={scope} targets={allocation?.targets ?? null} threshold={allocation?.threshold ?? "2"} />
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby={`${ids}-actual`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-actual`}>{ACTUAL_HEADING}</CardHeading>
          <ActualTable result={result} securityNames={securityNames} depotNames={depotNames} headingId={`${ids}-actual`} />
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby={`${ids}-proposal`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-proposal`}>{PROPOSAL_HEADING}</CardHeading>
          {allocation === null ? (
            <Typography variant="body2">{NO_TARGETS_TEXT}</Typography>
          ) : (
            <Stack spacing={2}>
              <DepositForm key={`${scope}|${depositText}`} scope={scope} depositText={depositText} depositInvalid={depositInvalid} />
              <Proposal result={result} securityNames={securityNames} depotNames={depotNames} ids={ids} />
              <Alert severity="info">{PROPOSAL_HINT}</Alert>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
