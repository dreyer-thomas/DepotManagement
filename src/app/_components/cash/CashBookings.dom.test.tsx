// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { LogoProvider } from "../securities/LogoContext";
import { CashBookings } from "./CashBookings";

registerDomCleanup();

describe("CashBookings logos", () => {
  it("loads a booking's stored Security logo by its Security id", () => {
    const { container } = render(
      <LogoProvider versions={{ s1: "1" }}>
        <CashBookings
          balance="10"
          bookings={[
            {
              id: "t1",
              type: "DIVIDEND",
              date: "2026-10-20",
              sequence: 1,
              security: { id: "s1", name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null, assetType: "STOCK" },
              cashEffect: "10",
              balance: "10",
              note: null,
            },
          ]}
        />
      </LogoProvider>,
    );
    expect(container.querySelectorAll('img[src="/api/logos/s1?v=1"]')).toHaveLength(1);
  });
});
