// @vitest-environment happy-dom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { LogoProvider } from "./LogoContext";
import { SecurityLogo } from "./SecurityLogo";

registerDomCleanup();

function avatar(container: HTMLElement) {
  return container.querySelector(".MuiAvatar-root") as HTMLElement;
}

describe("SecurityLogo", () => {
  it("renders the initials immediately when the Security has no stored logo", () => {
    const { container } = render(
      <LogoProvider versions={{ other: "1" }}>
        <SecurityLogo securityId="s1" name="SAP SE" />
      </LogoProvider>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(avatar(container).textContent).toBe("SS");
    expect(avatar(container).getAttribute("aria-hidden")).toBe("true");
  });

  it("loads a stored logo from the app's own route in the same 32px box", () => {
    const { container } = render(
      <LogoProvider versions={{ s1: "1761472800000" }}>
        <SecurityLogo securityId="s1" name="SAP SE" />
      </LogoProvider>,
    );
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/logos/s1?v=1761472800000");
    expect(img.getAttribute("alt")).toBe("");
    const style = getComputedStyle(avatar(container));
    expect([style.width, style.height]).toEqual(["32px", "32px"]);
    // Initials fallback stays readable: the name color is on the Avatar, white only behind the image.
    expect(style.backgroundColor).not.toMatch(/^(#fff(fff)?|white|rgb\(255, 255, 255\))$/i);
    expect(getComputedStyle(img).backgroundColor).toMatch(/^(#fff(fff)?|white|rgb\(255, 255, 255\))$/i);
    expect(container.innerHTML).not.toMatch(/logo\.dev|elbstream|coingecko/i);
  });

  it("falls back to the initials when the image fails", () => {
    const { container } = render(
      <LogoProvider versions={{ s1: "1" }}>
        <SecurityLogo securityId="s1" name="Bitcoin" />
      </LogoProvider>,
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(avatar(container).textContent).toBe("BI");
  });

  it("renders initials without a provider (default context)", () => {
    const { container } = render(<SecurityLogo securityId="s1" name="Apple Inc." />);
    expect(container.querySelector("img")).toBeNull();
    expect(avatar(container).textContent).toBe("AI");
  });
});
