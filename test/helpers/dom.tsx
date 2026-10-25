// Shared setup for `*.dom.test.tsx` files (opt in with a `// @vitest-environment happy-dom` docblock).
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Unmounts everything Testing Library rendered after each test. Vitest globals are off, so Testing
 * Library cannot register this hook itself; call once at the top level of each DOM test file.
 */
export function registerDomCleanup(): void {
  afterEach(() => {
    cleanup();
  });
}

/** The entries of a FormData passed to a mocked server action, with Files kept as they are. */
export function formEntries(data: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(data.entries());
}

/**
 * Chooses `file` in a file input the way a browser does. `userEvent.upload` overrides `files` on the
 * element, which happy-dom's `new FormData(form)` does not see; the input's own setter is used instead.
 */
export function chooseFile(input: HTMLInputElement, file: File): void {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  fireEvent.change(input);
}
