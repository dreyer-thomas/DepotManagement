// Positions as composition holdings (core/composition, core/allocation). Safe to import from client
// components (type imports only).
import type { CompositionHolding } from "@/core/composition";
import type { PositionRecord } from "./positions";

/** The Depot's priced Positions as composition holdings; Positions without a price (`value` null) are left out. */
export function compositionHoldings(depot: { id: string; name: string }, positions: readonly PositionRecord[]): CompositionHolding[] {
  return positions.flatMap((position) =>
    position.value === null
      ? []
      : [
          {
            securityId: position.security.id,
            securityName: position.security.name,
            assetType: position.security.assetType,
            depotId: depot.id,
            depotName: depot.name,
            value: position.value,
          },
        ],
  );
}
