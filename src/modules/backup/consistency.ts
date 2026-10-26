// Pure consistency check of a schema-valid export file (story 6.2): ids are unique per record kind, every
// reference resolves and the database's unique keys hold, so a restore fails before writing instead of
// on a constraint. The returned path names the offending field, never its value.
import type { ExportFile } from "./schema";

export type ConsistencyResult = { ok: true } | { ok: false; path: string };

class Inconsistent extends Error {
  constructor(readonly path: string) {
    super("inconsistent");
  }
}

/** Throws when `key` was already seen in `seen`; records it otherwise. */
function unique(seen: Set<string>, key: string, path: string): void {
  if (seen.has(key)) throw new Inconsistent(path);
  seen.add(key);
}

function resolves(ids: ReadonlySet<string>, id: string | null, path: string): void {
  if (id !== null && !ids.has(id)) throw new Inconsistent(path);
}

/** Collects the ids of `records`, failing on the first duplicate. */
function idsOf(records: readonly { id: string }[], kind: string): Set<string> {
  const ids = new Set<string>();
  records.forEach((record, index) => unique(ids, record.id, `${kind}.${index}.id`));
  return ids;
}

const key = (...parts: (string | number | null)[]) => JSON.stringify(parts);

/** Checks ids, references and unique keys of `file`; the first violation's path is returned. */
export function checkConsistency(file: ExportFile): ConsistencyResult {
  try {
    const depotIds = idsOf(file.depots, "depots");
    const securityIds = idsOf(file.securities, "securities");
    idsOf(file.providerMappings, "providerMappings");
    idsOf(file.transactions, "transactions");
    idsOf(file.corporateActions, "corporateActions");
    idsOf(file.reconciliationRuns, "reconciliationRuns");
    const rowIds = new Set<string>();
    file.reconciliationRuns.forEach((run, r) =>
      run.rows.forEach((row, i) => unique(rowIds, row.id, `reconciliationRuns.${r}.rows.${i}.id`)),
    );
    idsOf(file.prices, "prices");
    idsOf(file.logos, "logos");

    const names = new Set<string>();
    file.depots.forEach((depot, i) => unique(names, depot.name, `depots.${i}.name`));
    const isins = new Set<string>();
    const symbols = new Set<string>();
    file.securities.forEach((security, i) => {
      if (security.isin !== null) unique(isins, security.isin, `securities.${i}.isin`);
      if (security.cryptoSymbol !== null) unique(symbols, security.cryptoSymbol, `securities.${i}.cryptoSymbol`);
    });

    const mapped = new Set<string>();
    file.providerMappings.forEach((mapping, i) => {
      resolves(securityIds, mapping.securityId, `providerMappings.${i}.securityId`);
      unique(mapped, mapping.securityId, `providerMappings.${i}.securityId`);
    });

    const slots = new Set<string>();
    file.transactions.forEach((transaction, i) => {
      resolves(depotIds, transaction.depotId, `transactions.${i}.depotId`);
      resolves(securityIds, transaction.securityId, `transactions.${i}.securityId`);
      unique(slots, key(transaction.depotId, transaction.date, transaction.sequence), `transactions.${i}.sequence`);
    });

    const actions = new Set<string>();
    file.corporateActions.forEach((action, i) => {
      resolves(securityIds, action.securityId, `corporateActions.${i}.securityId`);
      resolves(securityIds, action.newSecurityId, `corporateActions.${i}.newSecurityId`);
      unique(actions, key(action.securityId, action.type, action.date), `corporateActions.${i}.date`);
    });

    file.reconciliationRuns.forEach((run, r) => {
      resolves(depotIds, run.depotId, `reconciliationRuns.${r}.depotId`);
      // One row per Position and one Cash Account row (securityId null) per run.
      const rowKeys = new Set<string>();
      run.rows.forEach((row, i) => {
        const path = `reconciliationRuns.${r}.rows.${i}`;
        if (row.runId !== run.id) throw new Inconsistent(`${path}.runId`);
        resolves(securityIds, row.securityId, `${path}.securityId`);
        unique(rowKeys, key(row.securityId), `${path}.securityId`);
      });
    });

    const prices = new Set<string>();
    file.prices.forEach((price, i) => {
      resolves(securityIds, price.securityId, `prices.${i}.securityId`);
      unique(prices, key(price.securityId, price.date, price.source), `prices.${i}.source`);
    });

    const logos = new Set<string>();
    file.logos.forEach((logo, i) => {
      resolves(securityIds, logo.securityId, `logos.${i}.securityId`);
      unique(logos, logo.securityId, `logos.${i}.securityId`);
    });
  } catch (error) {
    if (error instanceof Inconsistent) return { ok: false, path: error.path };
    throw error;
  }
  return { ok: true };
}
