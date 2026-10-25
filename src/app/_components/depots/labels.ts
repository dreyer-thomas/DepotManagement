import type { Broker, DepotFailureReason } from "@/modules/ledger";

/** German display names of the Brokers, in selection order. */
export const BROKER_LABELS: Record<Broker, string> = {
  COMDIRECT: "comdirect",
  DEUTSCHE_BANK: "Deutsche Bank",
  FINANZEN_ZERO: "finanzen.net zero",
};

export const BROKER_OPTIONS = Object.entries(BROKER_LABELS).map(([value, label]) => ({
  value: value as Broker,
  label,
}));

export function brokerLabel(broker: Broker): string {
  return BROKER_LABELS[broker];
}

export type DepotErrorReason = DepotFailureReason | "unauthorized";

const DEPOT_ERROR_MESSAGES: Record<DepotErrorReason, string> = {
  "name-empty": "Bitte einen Namen eingeben.",
  "name-too-long": "Höchstens 60 Zeichen.",
  "name-taken": "Ein Depot mit diesem Namen gibt es bereits.",
  "broker-invalid": "Bitte einen Broker wählen.",
  "not-found": "Depot nicht gefunden.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a Depot write failure. */
export function depotErrorMessage(reason: DepotErrorReason): string {
  return DEPOT_ERROR_MESSAGES[reason];
}

/** Which form field an error belongs to; others show as an Alert. */
export function depotErrorField(reason: DepotErrorReason): "name" | "broker" | undefined {
  if (reason === "broker-invalid") return "broker";
  if (reason === "not-found" || reason === "unauthorized") return undefined;
  return "name";
}
