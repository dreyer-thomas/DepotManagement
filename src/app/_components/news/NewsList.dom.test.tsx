// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
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
  },
  {
    id: "a2",
    securityId: "s2",
    name: "Siemens AG",
    title: "Siemens baut Werk aus",
    url: "https://news.example.com/siemens-werk?id=2&ref=rss",
    source: "Example Wire",
    publishedAt: "2026-10-24T08:00:00.000Z",
  },
];

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

  it("shows the empty state", () => {
    render(<NewsList articles={[]} />);
    expect(screen.getByText("Keine Nachrichten der letzten 14 Tage.")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
