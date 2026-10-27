#!/usr/bin/env node
// Prints an AUTH_PASSWORD_HASH line for .env. The password is read from a hidden TTY prompt
// or from stdin (e.g. `printf 'secret\n' | npm run -s hash-password`), never from argv.
import bcrypt from "bcrypt";

const COST = 12;

/**
 * Reads one hidden line per prompt from the TTY in raw mode, echoing `*` per character. Input that
 * arrives in one chunk across several lines (fast typing, paste) carries over to the next prompt.
 */
function readHiddenLines(prompts) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    const lines = [];
    let value = "";
    stderr.write(prompts[0]);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      if (error) {
        stderr.write("\n");
        reject(error);
      } else {
        resolve(lines);
      }
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stderr.write("\n");
          lines.push(value);
          value = "";
          if (lines.length === prompts.length) {
            finish();
            return;
          }
          stderr.write(prompts[lines.length]);
        } else if (char === "\u0003") {
          finish(new Error("Aborted."));
          return;
        } else if (char === "\u007f" || char === "\b") {
          if (value) {
            value = value.slice(0, -1);
            stderr.write("\b \b");
          }
        } else {
          value += char;
          stderr.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  // Only the first line counts; strip the trailing line break.
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0];
}

async function main() {
  let password;
  if (process.stdin.isTTY) {
    const [first, repeat] = await readHiddenLines(["Password: ", "Repeat password: "]);
    password = first;
    if (password !== repeat) {
      console.error("The passwords do not match.");
      process.exit(1);
    }
  } else {
    password = await readStdin();
  }
  if (!password) {
    console.error("No password given.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, COST);
  // @next/env expands `$name` in .env values, so every `$` must be written as `\$`.
  process.stdout.write(`AUTH_PASSWORD_HASH=${hash.replaceAll("$", "\\$")}\n`);
  console.error("Paste this line into .env. For a systemd EnvironmentFile (production), remove the backslashes.");
  console.error("Generate SESSION_SECRET with: openssl rand -base64 48");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
