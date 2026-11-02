#!/usr/bin/env node
// CI gate (dev doc §9.9): SQL is parameterised. Any prepare()/exec() whose statement text is built
// with `${...}` must carry a `// sql:` justification on the same or the preceding line, and the
// interpolated values must never be request data. Reviewers see the reason next to the risk.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../server/src/", import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".ts")) files.push(full);
  }
})(root);

const problems = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // A call that opens a template literal with an interpolation on this line…
    const opensTemplate = /\.(prepare|exec)\(\s*`/.test(line);
    if (!opensTemplate) return;
    // …possibly spanning lines: gather until the backtick closes.
    let text = line;
    let j = i;
    while ((text.match(/`/g) ?? []).length < 2 && j + 1 < lines.length) text += `\n${lines[++j]}`;
    if (!/\$\{/.test(text)) return;
    const context = `${lines[i - 1] ?? ""}\n${line}`;
    if (!/\/\/\s*sql:/.test(context)) {
      problems.push(
        `${relative(process.cwd(), file)}:${i + 1}: interpolated SQL without a "// sql:" justification`,
      );
    }
  });
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`check-sql: ${files.length} files, no unjustified interpolated SQL`);
