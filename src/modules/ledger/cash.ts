import { prisma } from "@/db";
import { cashBookings } from "@/core/cash";
import type { LedgerDb } from "./depots";
import type { SecuritySummary } from "./securities";
import type { TransactionType } from "./transactions";

/** One Cash Account booking (computed on read, never stored). */
export type CashBookingRecord = {
  id: string;
  type: TransactionType;
  date: string;
  sequence: number;
  security: SecuritySummary | null;
  /** Signed change of the balance. */
  cashEffect: string;
  /** Running balance after this booking. */
  balance: string;
  /** The Transaction's note, e.g. "Kontoabgleich"; `null` without one. */
  note: string | null;
};

const SECURITY_SELECT = { id: true, name: true, isin: true, cryptoSymbol: true, assetType: true } as const;

/** A Depot's Cash Account bookings, newest first by (date, sequence), with running balances. Read-only. */
export async function listCashBookings(depotId: string, db: LedgerDb = prisma): Promise<CashBookingRecord[]> {
  const rows = await db.transaction.findMany({
    where: { depotId },
    select: {
      id: true,
      type: true,
      date: true,
      sequence: true,
      amount: true,
      fee: true,
      tax: true,
      note: true,
      security: { select: SECURITY_SELECT },
    },
  });
  return cashBookings(rows)
    .reverse()
    .map(({ id, type, date, sequence, security, cashEffect, balance, note }) => ({
      id,
      type,
      date,
      sequence,
      security,
      cashEffect,
      balance,
      note,
    }));
}
