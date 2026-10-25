// Runs once before the server handles requests. `next build` does not call register(),
// so builds need no auth environment.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkAuthConfigOrExit } = await import("./instrumentation-node");
    checkAuthConfigOrExit();
  }
}
