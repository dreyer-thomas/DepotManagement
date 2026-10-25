"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { duplicateWarning } from "@/app/_components/transactions/transaction-form";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import {
  type ClassificationType,
  type Correction,
  CORRECTION_ASSET_TYPES,
  correctionDraft,
  correctionFields,
  itemKey,
  type MigrationDecisions,
  needsClassification,
  SECURITY_CORRECTION_TYPES,
} from "@/modules/migration/decisions";
import type { FlaggedRow, ParqetPreview, PreviewDuplicate } from "@/modules/migration";
import { ASSET_TYPE_LABELS } from "@/app/_components/transactions/labels";
import {
  CLASSIFICATION_OPTIONS,
  CORRECTION_TYPE_OPTIONS,
  DECISION_LABELS,
  flagReasonLabel,
  proposalTypeLabel,
  rawRowLabel,
  recordsLabel,
} from "./labels";

const TOUCH_TARGET = { minHeight: 44 };

type Props = {
  preview: ParqetPreview;
  decisions: MigrationDecisions;
  onChange: (decisions: MigrationDecisions) => void;
  disabled?: boolean;
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-labelledby={id} sx={{ mt: 3 }}>
      <Typography id={id} component="h3" variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

const ITEM_SX = { py: 1.5, borderBottom: 1, borderColor: "divider" } as const;

const FIELD_LABELS: Partial<Record<keyof Correction, string>> = {
  quantity: "Stück",
  price: "Kurs",
  amount: "Betrag",
  fee: "Gebühr",
  tax: "Steuer",
};

function CorrectionFields({
  id,
  correction,
  onChange,
  disabled,
}: {
  id: string;
  correction: Correction;
  onChange: (correction: Correction) => void;
  disabled?: boolean;
}) {
  const set = (field: keyof Correction) => (event: { target: { value: string } }) =>
    onChange({ ...correction, [field]: event.target.value } as Correction);
  const hasSecurity = SECURITY_CORRECTION_TYPES.includes(correction.type);
  return (
    <Box
      sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1.5, mt: 1.5 }}
      role="group"
      aria-label="Korrektur"
    >
      <TextField
        select
        size="small"
        label="Buchungsart"
        value={correction.type}
        onChange={set("type")}
        disabled={disabled}
        slotProps={{ select: { native: true }, htmlInput: { id: `${id}-type` } }}
      >
        {CORRECTION_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </TextField>
      <TextField
        size="small"
        type="date"
        label="Datum"
        value={correction.date}
        onChange={set("date")}
        disabled={disabled}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      {hasSecurity ? (
        <>
          <TextField size="small" label="ISIN / Symbol" value={correction.securityKey} onChange={set("securityKey")} disabled={disabled} />
          <TextField size="small" label="Name (nur neue Wertpapiere)" value={correction.securityName} onChange={set("securityName")} disabled={disabled} />
          <TextField
            select
            size="small"
            label="Art (nur neue Wertpapiere)"
            value={correction.assetType}
            onChange={set("assetType")}
            disabled={disabled}
            slotProps={{ select: { native: true } }}
          >
            <option value="">–</option>
            {CORRECTION_ASSET_TYPES.map((type) => (
              <option key={type} value={type}>
                {ASSET_TYPE_LABELS[type]}
              </option>
            ))}
          </TextField>
        </>
      ) : null}
      {correctionFields(correction.type).map((field) => (
        <TextField
          key={field}
          size="small"
          label={FIELD_LABELS[field]}
          value={correction[field]}
          onChange={set(field)}
          disabled={disabled}
          slotProps={{ htmlInput: { inputMode: "decimal" } }}
        />
      ))}
    </Box>
  );
}

function FlagItem({ flag, decisions, onChange, disabled }: { flag: FlaggedRow } & Omit<Props, "preview">) {
  const key = itemKey(flag);
  const decision = decisions.flags[key];
  const value = decision ? (decision.action === "skip" ? "skip" : "book") : null;
  const setFlag = (next: MigrationDecisions["flags"][string]) => onChange({ ...decisions, flags: { ...decisions.flags, [key]: next } });
  return (
    <Box component="li" sx={ITEM_SX}>
      <Typography variant="body2">
        {recordsLabel(flag.records)} – {flagReasonLabel(flag)}
      </Typography>
      {flag.rows.map((row, index) => (
        <Typography key={index} variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-all" }}>
          {rawRowLabel(row)}
        </Typography>
      ))}
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value}
        disabled={disabled}
        aria-label={`Entscheidung ${recordsLabel(flag.records)}`}
        onChange={(_event, next: "skip" | "book" | null) => {
          if (next === "skip") setFlag({ action: "skip" });
          if (next === "book") setFlag({ action: "book", correction: correctionDraft(flag) });
        }}
        sx={{ mt: 1, flexWrap: "wrap" }}
      >
        <ToggleButton value="skip" sx={TOUCH_TARGET}>
          {DECISION_LABELS.skip}
        </ToggleButton>
        <ToggleButton value="book" sx={TOUCH_TARGET}>
          {DECISION_LABELS.correct}
        </ToggleButton>
      </ToggleButtonGroup>
      {decision?.action === "book" ? (
        <CorrectionFields
          id={`flag-${key}`}
          correction={decision.correction}
          disabled={disabled}
          onChange={(correction) => setFlag({ action: "book", correction })}
        />
      ) : null}
    </Box>
  );
}

function proposalText(duplicate: PreviewDuplicate, nameOf: Map<string, string>): string {
  const { proposal } = duplicate;
  const security = proposal.securityKey ? `, ${nameOf.get(proposal.securityKey) ?? proposal.securityKey}` : "";
  const quantity = proposal.quantity ? `, ${formatQuantity(proposal.quantity)} Stück` : "";
  const value = proposal.type === "TAX" ? proposal.tax : proposal.amount;
  return `${proposalTypeLabel(proposal.type)} vom ${formatDate(proposal.date)}${security}${quantity}, ${formatMoney(value)}`;
}

/**
 * The decisions a preview needs before "Übernehmen": classify each new Security, skip or correct each
 * flagged row, skip or book each possible duplicate of the target Depot's ledger.
 */
export function ParqetDecisions({ preview, decisions, onChange, disabled }: Props) {
  const toClassify = preview.securities.filter(needsClassification);
  const nameOf = new Map(preview.securities.map((security) => [security.key, security.name]));
  return (
    <Box component="section" aria-labelledby="parqet-decisions-title" sx={{ mt: 3 }}>
      <Typography id="parqet-decisions-title" component="h2" variant="h6" sx={{ fontWeight: 600 }}>
        Entscheidungen
      </Typography>

      <Section id="parqet-classify" title="Neue Wertpapiere einordnen">
        {toClassify.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Wertpapiere einzuordnen.
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {toClassify.map((security) => (
              <Box
                component="li"
                key={security.key}
                sx={{ ...ITEM_SX, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}
              >
                <Box sx={{ flex: 1, minWidth: 160 }}>
                  <Typography variant="body2">{security.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {security.key}
                  </Typography>
                </Box>
                <TextField
                  select
                  size="small"
                  label="Art"
                  value={decisions.classifications[security.key] ?? ""}
                  disabled={disabled}
                  onChange={(event) => {
                    const rest = { ...decisions.classifications };
                    delete rest[security.key];
                    const value = event.target.value as ClassificationType | "";
                    onChange({ ...decisions, classifications: value ? { ...rest, [security.key]: value } : rest });
                  }}
                  slotProps={{ select: { native: true } }}
                  sx={{ minWidth: 160 }}
                >
                  <option value="">Bitte wählen</option>
                  {CLASSIFICATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </TextField>
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <Section id="parqet-flag-decisions" title="Markierte Zeilen entscheiden">
        {preview.flagged.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine markierten Zeilen.
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {preview.flagged.map((flag) => (
              <FlagItem key={itemKey(flag)} flag={flag} decisions={decisions} onChange={onChange} disabled={disabled} />
            ))}
          </Box>
        )}
      </Section>

      <Section id="parqet-duplicates" title="Mögliche Doppelbuchungen">
        {preview.duplicates.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Doppelbuchungen im Depot gefunden.
          </Typography>
        ) : (
          <Stack component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {preview.duplicates.map((duplicate) => (
              <Box component="li" key={duplicate.key} sx={ITEM_SX}>
                <Typography variant="body2">
                  {recordsLabel(duplicate.proposal.records)} – {proposalText(duplicate, nameOf)}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {duplicateWarning(duplicate)}
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={decisions.duplicates[duplicate.key] ?? null}
                  disabled={disabled}
                  aria-label={`Entscheidung ${recordsLabel(duplicate.proposal.records)}`}
                  onChange={(_event, next: "skip" | "book" | null) => {
                    if (next) onChange({ ...decisions, duplicates: { ...decisions.duplicates, [duplicate.key]: next } });
                  }}
                  sx={{ mt: 1, flexWrap: "wrap" }}
                >
                  <ToggleButton value="skip" sx={TOUCH_TARGET}>
                    {DECISION_LABELS.skip}
                  </ToggleButton>
                  <ToggleButton value="book" sx={TOUCH_TARGET}>
                    {DECISION_LABELS.book}
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>
            ))}
          </Stack>
        )}
      </Section>
    </Box>
  );
}
