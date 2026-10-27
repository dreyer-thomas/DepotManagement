// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import type { NewsListArticle } from "@/modules/news";
import { LogoProvider } from "../securities/LogoContext";
import { NewsList } from "./NewsList";

registerDomCleanup();

const articles: NewsListArticle[] = [
  {
    id: "a1",
    securityId: "s1",
    name: "SAP SE",
    title: "SAP hebt Prognose an",
    url: "https://news.example.com/sap-prognose",
    source: "Beispiel Zeitung",
    publishedAt: "2026-10-25T23:30:00.000Z",
    teaser: null,
  },
  {
    id: "a2",
    securityId: "s2",
    name: "Siemens AG",
    title: "Siemens baut Werk aus",
    url: "https://news.example.com/siemens-werk?id=2&ref=rss",
    source: "Example Wire",
    publishedAt: "2026-10-24T08:00:00.000Z",
    teaser: null,
  },
];

const teaserArticle: NewsListArticle = {
  id: "a3",
  securityId: "s1",
  name: "SAP SE",
  title: "SAP-Aktie legt nach Zahlen zu",
  url: "https://finance.example.com/sap-zahlen",
  source: "Muster Finanz",
  publishedAt: "2026-10-26T08:00:00.000Z",
  teaser: "SAP & Co melden erfundene Zahlen.",
};

describe("NewsList", () => {
  it("renders each headline as one external link with logo, name, source and Berlin date", () => {
    render(
      <LogoProvider versions={{ s1: "v1" }}>
        <NewsList articles={articles} />
      </LogoProvider>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    const first = screen.getByRole("link", { name: /SAP hebt Prognose an/ });
    expect(first.getAttribute("href")).toBe("https://news.example.com/sap-prognose");
    expect(first.getAttribute("target")).toBe("_blank");
    expect(first.getAttribute("rel")).toBe("noopener noreferrer");
    expect(first.textContent).toContain("SAP SE");
    // The new-tab behaviour is announced (visually hidden text inside each link).
    for (const link of links) expect(link.textContent).toContain(" (öffnet in neuem Tab)");
    expect(first.textContent).toContain("Beispiel Zeitung · 26.10.2026");
    expect(first.querySelector('img[src="/api/logos/s1?v=v1"]')).not.toBeNull();
    const second = screen.getByRole("link", { name: /Siemens baut Werk aus/ });
    expect(second.getAttribute("href")).toBe("https://news.example.com/siemens-werk?id=2&ref=rss");
    // No stored logo: initials instead.
    expect(within(second).getByText("SA")).toBeDefined();
    expect(second.textContent).toContain("Example Wire · 24.10.2026");
  });

  it("renders a teaser item as a collapsed accordion button with the Kurztext marker", async () => {
    render(<NewsList articles={[teaserArticle, articles[1]]} />);
    const button = screen.getByRole("button", { name: /SAP-Aktie legt nach Zahlen zu/ });
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toContain("SAP SE");
    expect(button.textContent).toContain("Muster Finanz · 26.10.2026");
    expect(button.textContent).toContain("Kurztext");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(panel?.getAttribute("role")).toBe("region");
    expect(panel?.getAttribute("aria-labelledby")).toBe(button.id);
    expect(panel?.hidden).toBe(true);
    // Collapsed: the article link is not exposed; the headline-only item stays one link.
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://news.example.com/siemens-werk?id=2&ref=rss",
    ]);

    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hidden).toBe(false);
    const region = screen.getByRole("region", { name: /SAP-Aktie legt nach Zahlen zu/ });
    expect(region.textContent).toContain("SAP & Co melden erfundene Zahlen.");
    expect(region.textContent).toContain("Muster Finanz · 26.10.2026");
    const link = within(region).getByRole("link", { name: /Zum Artikel/ });
    expect(link.getAttribute("href")).toBe("https://finance.example.com/sap-zahlen");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain(" (öffnet in neuem Tab)");

    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hidden).toBe(true);
  });

  it("toggles a teaser item with Enter and Space, independently of other items", async () => {
    const user = userEvent.setup();
    const other = { ...teaserArticle, id: "a4", title: "SAP zweite Meldung", url: "https://finance.example.com/zwei" };
    render(<NewsList articles={[teaserArticle, other]} />);
    const [first, second] = screen.getAllByRole("button");
    first.focus();
    await user.keyboard("{Enter}");
    expect(first.getAttribute("aria-expanded")).toBe("true");
    second.focus();
    await user.keyboard(" ");
    expect(second.getAttribute("aria-expanded")).toBe("true");
    // Several items may be open at once.
    expect(first.getAttribute("aria-expanded")).toBe("true");
    first.focus();
    await user.keyboard(" ");
    expect(first.getAttribute("aria-expanded")).toBe("false");
    await user.keyboard("{Enter}");
    expect(first.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the empty state", () => {
    render(<NewsList articles={[]} />);
    expect(screen.getByText("Keine Nachrichten der letzten 14 Tage.")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
