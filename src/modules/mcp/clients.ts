// RFC 7591 dynamic client registration (story 9.4). Redirect URIs are matched exactly later on, never by
// prefix or wildcard (AD-22).
import { prisma } from "@/db";
import type { Prisma } from "@/db/generated/prisma/client";
import { hashSecret, randomClientId, randomToken } from "./crypto";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type McpDb = Prisma.TransactionClient;

export const TOKEN_ENDPOINT_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
export type TokenEndpointAuthMethod = (typeof TOKEN_ENDPOINT_AUTH_METHODS)[number];

export const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
export type GrantType = (typeof GRANT_TYPES)[number];

export const CLIENT_NAME_MAX_LENGTH = 100;
export const DEFAULT_CLIENT_NAME = "Unbenannte App";
export const MAX_REDIRECT_URIS = 10;
const REDIRECT_URI_MAX_LENGTH = 2000;
/** Registrations are refused while this many clients exist (after the cleanup below). */
export const MAX_CLIENTS = 200;
/** A client older than this without any non-revoked grant is deleted before a new registration. */
export const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;

const LOOPBACK_REDIRECT = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?\//;

/**
 * True for a redirect URI a client may register: exactly `https://<host>…`, or `http://localhost[:port]/…`
 * / `http://127.0.0.1[:port]/…`; never a fragment, credentials, whitespace or control characters.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.length > REDIRECT_URI_MAX_LENGTH) return false;
  if (/[\s\u0000-\u001f\u007f#\\]/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (value.startsWith("https://")) return url.protocol === "https:" && url.hostname !== "";
  if (value.startsWith("http://")) return url.protocol === "http:" && LOOPBACK_REDIRECT.test(value);
  return false;
}

export type RegisteredClient = {
  id: string;
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: GrantType[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  clientSecretHash: string | null;
  createdAt: string;
};

export type RegistrationError = { error: "invalid_redirect_uri" | "invalid_client_metadata"; error_description: string };

export type RegistrationResult =
  | { ok: true; body: Record<string, unknown> }
  | ({ ok: false } & RegistrationError);

function invalid(error: RegistrationError["error"], description: string): { ok: false } & RegistrationError {
  return { ok: false, error, error_description: description };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

type ValidMetadata = {
  clientName: string;
  redirectUris: string[];
  grantTypes: GrantType[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
};

/** Validates RFC 7591 client metadata (unknown fields are ignored). Pure. */
export function validateClientMetadata(body: unknown): { ok: true; value: ValidMetadata } | ({ ok: false } & RegistrationError) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return invalid("invalid_client_metadata", "The request body must be a JSON object.");
  }
  const metadata = body as Record<string, unknown>;
  const uris = metadata.redirect_uris;
  if (!isStringArray(uris) || uris.length < 1 || uris.length > MAX_REDIRECT_URIS) {
    return invalid("invalid_redirect_uri", `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs.`);
  }
  if (!uris.every(isAllowedRedirectUri)) {
    return invalid("invalid_redirect_uri", "Each redirect URI must be https:// or http://localhost / http://127.0.0.1, without a fragment.");
  }

  let clientName = DEFAULT_CLIENT_NAME;
  if (metadata.client_name !== undefined && metadata.client_name !== null) {
    if (typeof metadata.client_name !== "string") return invalid("invalid_client_metadata", "client_name must be a string.");
    const trimmed = metadata.client_name.normalize("NFC").trim();
    if (trimmed.length > CLIENT_NAME_MAX_LENGTH) {
      return invalid("invalid_client_metadata", `client_name must have at most ${CLIENT_NAME_MAX_LENGTH} characters.`);
    }
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) return invalid("invalid_client_metadata", "client_name must not contain control characters.");
    if (trimmed !== "") clientName = trimmed;
  }

  let grantTypes: GrantType[] = ["authorization_code", "refresh_token"];
  if (metadata.grant_types !== undefined) {
    const values = metadata.grant_types;
    if (!isStringArray(values) || values.length === 0 || !values.every((value) => (GRANT_TYPES as readonly string[]).includes(value))) {
      return invalid("invalid_client_metadata", "grant_types may only contain authorization_code and refresh_token.");
    }
    if (!values.includes("authorization_code")) {
      return invalid("invalid_client_metadata", "grant_types must contain authorization_code.");
    }
    grantTypes = GRANT_TYPES.filter((type) => values.includes(type));
  }

  if (metadata.response_types !== undefined) {
    const values = metadata.response_types;
    if (!isStringArray(values) || values.length === 0 || !values.every((value) => value === "code")) {
      return invalid("invalid_client_metadata", "response_types may only contain code.");
    }
  }

  let tokenEndpointAuthMethod: TokenEndpointAuthMethod = "none";
  if (metadata.token_endpoint_auth_method !== undefined) {
    const method = metadata.token_endpoint_auth_method;
    if (typeof method !== "string" || !(TOKEN_ENDPOINT_AUTH_METHODS as readonly string[]).includes(method)) {
      return invalid("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.");
    }
    tokenEndpointAuthMethod = method as TokenEndpointAuthMethod;
  }

  return { ok: true, value: { clientName, redirectUris: [...new Set(uris)], grantTypes, tokenEndpointAuthMethod } };
}

/**
 * Registers a client. Before inserting, clients older than 24 h without any non-revoked grant are deleted; then a
 * registration is refused while 200 clients exist. A secret method gets a random `client_secret`
 * (returned once, stored hashed).
 */
export async function registerClient(body: unknown, db: McpDb = prisma, now: () => Date = () => new Date()): Promise<RegistrationResult> {
  const valid = validateClientMetadata(body);
  if (!valid.ok) return valid;
  const { clientName, redirectUris, grantTypes, tokenEndpointAuthMethod } = valid.value;
  const issuedAt = now();
  const staleBefore = new Date(issuedAt.getTime() - UNUSED_CLIENT_TTL_MS).toISOString();
  await db.oAuthClient.deleteMany({ where: { createdAt: { lt: staleBefore }, grants: { none: { revokedAt: null } } } });
  if ((await db.oAuthClient.count()) >= MAX_CLIENTS) {
    return invalid("invalid_client_metadata", "Too many registered clients.");
  }
  const clientId = randomClientId();
  const secret = tokenEndpointAuthMethod === "none" ? null : randomToken();
  await db.oAuthClient.create({
    data: {
      clientId,
      clientName,
      redirectUris: JSON.stringify(redirectUris),
      grantTypes: JSON.stringify(grantTypes),
      tokenEndpointAuthMethod,
      clientSecretHash: secret === null ? null : hashSecret(secret),
      createdAt: issuedAt.toISOString(),
    },
  });
  return {
    ok: true,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(issuedAt.getTime() / 1000),
      ...(secret === null ? {} : { client_secret: secret, client_secret_expires_at: 0 }),
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    },
  };
}

/** A JSON array of strings stored as text; anything else is an empty array. */
export function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The registered client with this public `client_id`, or null. */
export async function findClient(clientId: unknown, db: McpDb = prisma): Promise<RegisteredClient | null> {
  if (typeof clientId !== "string" || clientId === "" || clientId.length > 200) return null;
  const row = await db.oAuthClient.findUnique({ where: { clientId } });
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    redirectUris: parseJsonArray(row.redirectUris),
    grantTypes: parseJsonArray(row.grantTypes).filter((type): type is GrantType => (GRANT_TYPES as readonly string[]).includes(type)),
    tokenEndpointAuthMethod: (TOKEN_ENDPOINT_AUTH_METHODS as readonly string[]).includes(row.tokenEndpointAuthMethod)
      ? (row.tokenEndpointAuthMethod as TokenEndpointAuthMethod)
      : "none",
    clientSecretHash: row.clientSecretHash,
    createdAt: row.createdAt,
  };
}
