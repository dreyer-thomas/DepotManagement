/** Auth configuration read from the environment (AUTH_USERNAME, AUTH_PASSWORD_HASH, SESSION_SECRET). */
export type AuthConfig = {
  username: string;
  passwordHash: string;
  secret: string;
};

export type AuthConfigResult = { ok: true; config: AuthConfig } | { ok: false; problems: string[] };

type Env = Record<string, string | undefined>;

export const MIN_SECRET_LENGTH = 32;

// bcrypt modular crypt format: $2a$/$2b$/$2y$, cost 04-31, 22-char salt + 31-char hash.
const BCRYPT_HASH = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;

/**
 * Validates the auth variables. Empty counts as missing. Problems name the variable and the
 * broken rule, never the value.
 */
export function readAuthConfig(env: Env): AuthConfigResult {
  const problems: string[] = [];
  const username = env.AUTH_USERNAME ?? "";
  const passwordHash = env.AUTH_PASSWORD_HASH ?? "";
  const secret = env.SESSION_SECRET ?? "";

  if (username === "") {
    problems.push("AUTH_USERNAME is missing or empty.");
  }
  if (passwordHash === "") {
    problems.push("AUTH_PASSWORD_HASH is missing or empty.");
  } else if (!BCRYPT_HASH.test(passwordHash)) {
    problems.push(
      "AUTH_PASSWORD_HASH is not a bcrypt hash ($2a$/$2b$/$2y$, cost 04-31, 53 characters); in .env write every $ as \\$.",
    );
  }
  if (secret === "") {
    problems.push("SESSION_SECRET is missing or empty.");
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`);
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, config: { username, passwordHash, secret } };
}

/** Message for an invalid auth configuration: all problems plus where to look for help. */
export function formatAuthConfigProblems(problems: string[]): string {
  return [
    "Invalid auth configuration:",
    ...problems.map((problem) => `  - ${problem}`),
    'Set the variables in .env (generate the hash with `npm run hash-password`); see the "Login" section in README.md.',
  ].join("\n");
}

/** Like readAuthConfig, but throws an Error listing every problem. */
export function assertAuthConfig(env: Env): AuthConfig {
  const result = readAuthConfig(env);
  if (!result.ok) {
    throw new Error(formatAuthConfigProblems(result.problems));
  }
  return result.config;
}
