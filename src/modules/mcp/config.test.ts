import { describe, expect, it } from "vitest";
import { readMcpConfig } from "./config";

describe("readMcpConfig", () => {
  it.each([
    ["https://depot.example.com", "https://depot.example.com"],
    ["https://depot.example.com/", "https://depot.example.com"],
    [" http://localhost:3000 ", "http://localhost:3000"],
    ["https://depot.example.com:8443/", "https://depot.example.com:8443"],
  ])("accepts %j", (value, issuer) => {
    expect(readMcpConfig({ APP_URL: value })).toEqual({
      issuer,
      resource: `${issuer}/api/mcp`,
      resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/api/mcp`,
    });
  });

  it.each([
    undefined,
    "",
    "  ",
    "depot.example.com",
    "ftp://depot.example.com",
    "https://depot.example.com//",
    "https://depot.example.com/app",
    "https://depot.example.com/?x=1",
    "https://depot.example.com#x",
    "https://user:pw@depot.example.com",
    "https://",
  ])("refuses %j", (value) => {
    expect(readMcpConfig({ APP_URL: value })).toBeNull();
  });
});
