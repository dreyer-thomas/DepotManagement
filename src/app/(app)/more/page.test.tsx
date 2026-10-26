import { describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";

const countOpenBatches = vi.hoisted(() => vi.fn());
vi.mock("@/modules/import", () => ({ countOpenBatches }));

import { MoreLinks } from "@/app/_components/MoreLinks";
import MorePage from "./page";

describe("More page", () => {
  it("passes the open-import count to the links", async () => {
    countOpenBatches.mockResolvedValue(2);
    expect(findElement(await MorePage(), MoreLinks)?.props.openImports).toBe(2);
  });
});
