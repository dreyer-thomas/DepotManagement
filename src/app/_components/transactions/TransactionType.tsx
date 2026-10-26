import AccountBalanceOutlined from "@mui/icons-material/AccountBalanceOutlined";
import ArrowCircleDownOutlined from "@mui/icons-material/ArrowCircleDownOutlined";
import ArrowCircleUpOutlined from "@mui/icons-material/ArrowCircleUpOutlined";
import PaymentsOutlined from "@mui/icons-material/PaymentsOutlined";
import ReceiptLongOutlined from "@mui/icons-material/ReceiptLongOutlined";
import SellOutlined from "@mui/icons-material/SellOutlined";
import ShoppingCartOutlined from "@mui/icons-material/ShoppingCartOutlined";
import TuneOutlined from "@mui/icons-material/TuneOutlined";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import { formatMoney } from "@/core/format";
import type { TransactionType } from "@/modules/ledger";
import { gainLossTone } from "../positions/GainLossPill";
import { transactionTypeLabel } from "./labels";

const ICONS: Record<TransactionType, { Icon: ComponentType<SvgIconProps>; color: SvgIconProps["color"] }> = {
  BUY: { Icon: ShoppingCartOutlined, color: "primary" },
  SELL: { Icon: SellOutlined, color: "secondary" },
  DIVIDEND: { Icon: PaymentsOutlined, color: "primary" },
  FEE: { Icon: ReceiptLongOutlined, color: "action" },
  TAX: { Icon: AccountBalanceOutlined, color: "action" },
  DEPOSIT: { Icon: ArrowCircleDownOutlined, color: "primary" },
  WITHDRAWAL: { Icon: ArrowCircleUpOutlined, color: "secondary" },
  ADJUSTMENT: { Icon: TuneOutlined, color: "action" },
};

/** Type icon (decorative) plus German label. */
export function TransactionTypeLabel({ type }: { type: TransactionType }) {
  const { Icon, color } = ICONS[type];
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", whiteSpace: "nowrap" }}>
      <Icon fontSize="small" aria-hidden color={color} />
      <span>{transactionTypeLabel(type)}</span>
    </Stack>
  );
}

/** A Transaction's note (e.g. "Kontoabgleich") as a caption under its type; nothing without one. */
export function NoteCaption({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
      {note}
    </Typography>
  );
}

/** Signed cash effect: the sign always shows, gain/loss color only reinforces it. */
export function CashEffectText({ value }: { value: string }) {
  const tone = gainLossTone(value);
  return (
    <Box component="span" sx={{ color: tone ? `${tone}.main` : undefined, fontVariantNumeric: "tabular-nums" }}>
      {formatMoney(value, { sign: true })}
    </Box>
  );
}
