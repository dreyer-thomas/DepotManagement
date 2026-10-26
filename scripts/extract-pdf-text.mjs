#!/usr/bin/env node
// Prints the text unpdf extracts from a local PDF (same options as src/modules/import/extract.ts) to
// stdout, so a real broker document can be anonymised into a parser fixture. Writes no files; redirect
// the output outside the repo, e.g. `npm run -s extract-pdf-text -- ~/Downloads/doc.pdf > /tmp/doc.txt`.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run -s extract-pdf-text -- <file.pdf>");
    process.exit(1);
  }
  // npm runs scripts from the package root; INIT_CWD is where the user invoked npm.
  const bytes = new Uint8Array(await readFile(path.resolve(process.env.INIT_CWD ?? process.cwd(), file)));
  const document = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    const { text } = await extractText(document, { mergePages: true });
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  } finally {
    await document.loadingTask.destroy().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
