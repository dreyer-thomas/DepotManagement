"use server";

import { revalidatePath } from "next/cache";
import { type Segment, SEGMENTS } from "@/core/rebalancing";
import { getSession } from "@/modules/auth";
import { setTargetAllocation, type SetTargetAllocationResult } from "@/modules/rebalancing";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

/** Result of "Zielallokation speichern"; `null` before the first submit. */
export type SetTargetAllocationActionState = SetTargetAllocationResult | typeof UNAUTHORIZED | null;

/**
 * Analysen › Zielallokation: stores the targets of field `scope` (`portfolio` or a Depot id) from the fields
 * `target-<segment>` (absent or empty = 0) and `threshold` (empty = 2). Revalidates Analysen.
 */
export async function setTargetAllocationAction(
  _previous: SetTargetAllocationActionState,
  formData: FormData,
): Promise<SetTargetAllocationActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const targets: Partial<Record<Segment, unknown>> = {};
  for (const segment of SEGMENTS) {
    const value = formData.get(`target-${segment}`);
    if (value !== null) targets[segment] = value;
  }
  const scope = formData.get("scope");
  const result = await setTargetAllocation(typeof scope === "string" ? scope.trim() : "", targets, formData.get("threshold"));
  if (result.ok) revalidatePath("/analyses");
  return result;
}
