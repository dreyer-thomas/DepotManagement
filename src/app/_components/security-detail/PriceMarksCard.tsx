"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { CardHeading } from "@/app/_components/overview/CardHeading";
import {
  breachPillText,
  markMetaText,
  NO_PRICE_MARKS_TEXT,
  PRICE_MARKS_NOTE,
  stopRowText,
  targetRowText,
} from "@/app/_components/price-marks/labels";
import { BreachPill } from "@/app/_components/price-marks/BreachPill";
import type { PriceMarksEditInfo } from "@/app/_components/price-marks/PriceMarkFields";
import { PriceMarksDialog } from "@/app/_components/price-marks/PriceMarksDialog";
import type { PriceMarkState } from "@/core/price-marks";

export const PRICE_MARKS_CARD_HEADING = "Kursmarken";

function MarkRow({ text, meta, pill }: { text: string; meta: string; pill: string | null }) {
  return (
    <li>
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {text}
        </Typography>
        {pill ? <BreachPill>{pill}</BreachPill> : null}
      </Stack>
      <Typography variant="caption" color="text.secondary" component="p">
        {meta}
      </Typography>
    </li>
  );
}

/**
 * "Kursmarken" (story 12.3, both detail layouts, after the price chart): the stop and the target with value
 * and distance from the core state (`priceMarksView`), source and set date, a breach pill on the breached
 * mark ("Stopp unterschritten" / "Ziel erreicht" with the Price date) and the note what they are checked
 * against; without marks only "Keine Kursmarken". "Kursmarken bearbeiten" opens the marks dialog. The card
 * never compares prices itself.
 */
export function PriceMarksCard({
  security,
  info,
  state,
  today,
}: {
  security: { id: string; name: string; isin: string | null; cryptoSymbol: string | null };
  /** The marks (as the dialog edits them), latest Price and analyst target. */
  info: PriceMarksEditInfo;
  /** The core state of the marks as of today. */
  state: PriceMarkState;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const { marks } = info;
  const pill = (breach: "stop" | "target") =>
    state.breached === breach && state.priceDate !== null ? breachPillText(breach, state.priceDate) : null;
  const rows =
    marks === null
      ? []
      : [
          ...(marks.stop && state.stop
            ? [{ key: "stop", text: stopRowText(marks.stop, state.stop), meta: markMetaText(marks.stop), pill: pill("stop") }]
            : []),
          ...(marks.target && state.target
            ? [{ key: "target", text: targetRowText(state.target), meta: markMetaText(marks.target), pill: pill("target") }]
            : []),
        ];
  return (
    <Box component="section" aria-labelledby="security-price-marks" sx={{ mb: 1.5 }}>
      <Card>
        <CardContent>
          <CardHeading id="security-price-marks">{PRICE_MARKS_CARD_HEADING}</CardHeading>
          <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
            {marks === null ? (
              <Typography variant="body2">{NO_PRICE_MARKS_TEXT}</Typography>
            ) : (
              <>
                <Stack component="ul" spacing={1} sx={{ listStyle: "none", p: 0, m: 0 }}>
                  {rows.map(({ key, ...row }) => (
                    <MarkRow key={key} {...row} />
                  ))}
                </Stack>
                <Typography variant="caption" color="text.secondary" component="p">
                  {PRICE_MARKS_NOTE}
                </Typography>
              </>
            )}
            <Button
              size="small"
              startIcon={<EditOutlined aria-hidden />}
              aria-haspopup="dialog"
              onClick={() => {
                setSession((value) => value + 1);
                setOpen(true);
              }}
              sx={{ minHeight: 44 }}
            >
              Kursmarken bearbeiten
            </Button>
          </Stack>
        </CardContent>
      </Card>
      {session > 0 ? (
        <PriceMarksDialog open={open} onClose={() => setOpen(false)} formKey={session} security={security} info={info} today={today} />
      ) : null}
    </Box>
  );
}
