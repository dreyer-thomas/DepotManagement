// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { PriceDate } from "./StaleBadge";

registerDomCleanup();

const info = {
  date: "2026-10-22",
  source: "provider" as const,
  fetchedAt: "2026-10-22T18:05:00.000Z",
  provider: "YAHOO",
};

describe("PriceDate", () => {
  it("shows a plain date for a fresh price", () => {
    render(<PriceDate info={{ ...info, date: "2026-10-24", stale: false }} />);
    expect(screen.getByText("Kurs vom 24.10.2026").tabIndex).not.toBe(0);
  });

  it("shows a focusable stale badge whose tooltip names source and fetch time", async () => {
    const user = userEvent.setup({ delay: null });
    render(<PriceDate info={{ ...info, stale: true }} />);
    const badge = screen.getByText("Kurs vom 22.10.2026 – veraltet");
    await user.tab();
    expect(document.activeElement).toBe(badge);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Yahoo Finance · abgerufen 22.10.2026, 20:05");
  });
});
