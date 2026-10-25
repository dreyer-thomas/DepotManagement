#!/usr/bin/env node
// Prints an AUTH_PASSWORD_HASH line for .env. The password is read from a hidden TTY prompt
// or from stdin (e.g. `printf 'secret\n' | npm run -s hash-password`), never from argv.
import bcrypt from "bcrypt";

const COST = 12;

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = (result, error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stderr.write("\n");
      if (error) reject(error);
      else resolve(result);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          done(value);
          return;
        }
        if (char === "\u0003") {
          done(null, new Error("Aborted."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
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
    password = await readHidden("Password: ");
    const repeat = await readHidden("Repeat password: ");
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
  console.error("Paste this line into .env. Generate SESSION_SECRET with: openssl rand -base64 48");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
