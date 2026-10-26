// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { EXPORT_FAILED_MESSAGE, ExportButton, REVOKE_DELAY_MS } from "./ExportButton";

registerDomCleanup();

const FILE_NAME = "depotmanagement-export-20261026-101500.json";
let saved: { href: string; download: string }[];
let assign: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
const originalUrl = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

beforeEach(() => {
  saved = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download });
  });
  createObjectURL = vi.fn(() => "blob:export-1");
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
  assign = vi.fn();
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign } as Location);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  URL.createObjectURL = originalUrl.createObjectURL;
  URL.revokeObjectURL = originalUrl.revokeObjectURL;
});

function stubFetch(result: Response | Error) {
  const fetchSpy = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

async function clickExport() {
  const user = userEvent.setup({ delay: null });
  render(<ExportButton />);
  await user.click(screen.getByRole("button", { name: "Exportieren" }));
  return user;
}

describe("ExportButton", () => {
  it("saves a 200 body under the file name from Content-Disposition and revokes the URL later", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const fetchSpy = stubFetch(
      new Response('{"schemaVersion": 1}', {
        status: 200,
        headers: { "Content-Disposition": `attachment; filename="${FILE_NAME}"` },
      }),
    );
    await clickExport();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(fetchSpy).toHaveBeenCalledWith("/api/export", expect.anything());
    expect(saved[0]).toEqual({ href: "blob:export-1", download: FILE_NAME });
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe('{"schemaVersion": 1}');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    // shouldAdvanceTime lets a few real milliseconds pass; stay a second short of the deadline.
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1_000);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export-1");
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Exportieren" }).hasAttribute("disabled")).toBe(false));
  });

  it("navigates to the login on 401 and saves nothing", async () => {
    stubFetch(Response.json({ error: "unauthorized" }, { status: 401 }));
    await clickExport();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login?next=%2Fsettings&expired=1"));
    expect(saved).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("shows the error Alert on 500 and saves nothing; a new click clears it", async () => {
    stubFetch(Response.json({ error: "export-failed" }, { status: 500 }));
    const user = await clickExport();
    expect((await screen.findByRole("alert")).textContent).toBe(EXPORT_FAILED_MESSAGE);
    expect(saved).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();

    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (release = resolve))));
    await user.click(screen.getByRole("button", { name: "Exportieren" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("button", { name: "Exportieren" }).hasAttribute("disabled")).toBe(true);
    release(Response.json({ error: "export-failed" }, { status: 500 }));
    expect((await screen.findByRole("alert")).textContent).toBe(EXPORT_FAILED_MESSAGE);
  });

  it("shows the error Alert on a network error and saves nothing", async () => {
    stubFetch(new TypeError("fetch failed"));
    await clickExport();
    expect((await screen.findByRole("alert")).textContent).toBe(EXPORT_FAILED_MESSAGE);
    expect(saved).toEqual([]);
  });
});
