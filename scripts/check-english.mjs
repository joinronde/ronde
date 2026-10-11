// Fails when French text shows up outside the message catalogs of other languages: code, comments, file names,
// docs and defaults must be in English. Tests may assert French output on purpose and are skipped.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SKIP = [
  // Catalogs of the other languages (code, comments and English catalogs are checked)
  /(^|\/)messages\/(?!en\/)[a-z]{2}\//,
  // Translated guides of the documentation, next to the English README.md
  /(^|\/)docs\/.+\.[a-z]{2}\.md$/,
  /(^|\/)tests?\//,
  /\.test\.tsx?$/,
  /(^|\/)src\/generated\//,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)LICENSE$/,
  /^scripts\/check-english\.mjs$/,
  /\.(png|jpe?g|webp|mp3|mp4|svg|ico|woff2?)$/,
];
const ACCENTS = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙÜŸŒ]/;
const STOPWORDS = /\b(le|la|les|des|une|est|pour|dans|avec|sur|qui|que|pas|ou|au|aux|du|ce|cette|sont|être|fait|faire)\b/i;
const QUOTES = /[«»]/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !SKIP.some((re) => re.test(f)));

const problems = [];
for (const file of files) {
  if (ACCENTS.test(file) && STOPWORDS.test(file.replace(/[/_.-]/g, " "))) problems.push(`${file}: French file name`);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    if (QUOTES.test(line) || (ACCENTS.test(line) && STOPWORDS.test(line))) problems.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (problems.length) {
  console.error(`French text found outside messages/fr (${problems.length}):\n` + problems.join("\n"));
  process.exit(1);
}
console.log(`English check: ${files.length} files clean.`);
