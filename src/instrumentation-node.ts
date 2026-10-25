import { formatAuthConfigProblems, readAuthConfig } from "@/modules/auth/config";

/**
 * Stops the process when the auth variables are missing or invalid. Uses process.exit because
 * an error thrown in register() is not guaranteed to stop the server. Never prints values.
 */
export function checkAuthConfigOrExit(): void {
  const result = readAuthConfig(process.env);
  if (!result.ok) {
    console.error(formatAuthConfigProblems(result.problems));
    process.exit(1);
  }
}
