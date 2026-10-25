import bcrypt from "bcrypt";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { checkCredentials } from "./credentials";

let config: { username: string; passwordHash: string };

beforeAll(async () => {
  // Synthetic credentials, low cost to keep the test fast.
  config = { username: "tester", passwordHash: await bcrypt.hash("correct horse", 4) };
});

describe("checkCredentials", () => {
  it("accepts the correct username and password", async () => {
    expect(await checkCredentials("tester", "correct horse", config)).toBe(true);
  });

  it("rejects a wrong username", async () => {
    expect(await checkCredentials("someone", "correct horse", config)).toBe(false);
    expect(await checkCredentials("teste", "correct horse", config)).toBe(false);
    expect(await checkCredentials("", "correct horse", config)).toBe(false);
  });

  it("rejects a wrong password", async () => {
    expect(await checkCredentials("tester", "wrong", config)).toBe(false);
    expect(await checkCredentials("tester", "", config)).toBe(false);
  });

  it("runs bcrypt.compare even when the username is wrong", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    try {
      await checkCredentials("someone", "correct horse", config);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe("correct horse");
    } finally {
      spy.mockRestore();
    }
  });
});
