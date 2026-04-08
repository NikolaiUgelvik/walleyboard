import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const rootDir = process.cwd();
const maxLines = 1500;
const sourceRoots = [
  join(rootDir, "apps"),
  join(rootDir, "packages"),
];
const allowedExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

function shouldSkipPath(path) {
  return (
    path.includes(`${join("node_modules", "")}`) ||
    path.includes(`${join("dist", "")}`) ||
    path.endsWith(".d.ts") ||
    path.includes(".test.") ||
    path.includes(".spec.")
  );
}

function listSourceFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (shouldSkipPath(path)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!allowedExtensions.has(extname(entry.name))) {
      continue;
    }

    if (!path.includes(`${join("src", "")}`)) {
      continue;
    }

    files.push(path);
  }

  return files;
}

function countLines(path) {
  const content = readFileSync(path, "utf8");
  if (content.length === 0) {
    return 0;
  }

  return content.endsWith("\n")
    ? content.split("\n").length - 1
    : content.split("\n").length;
}

const oversizedFiles = sourceRoots
  .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
  .flatMap((dir) => listSourceFiles(dir))
  .map((path) => ({
    path,
    lines: countLines(path),
  }))
  .filter((entry) => entry.lines > maxLines)
  .sort((left, right) => right.lines - left.lines);

if (oversizedFiles.length === 0) {
  console.log(
    `Production source size check passed. No files exceed ${maxLines} lines.`,
  );
  process.exit(0);
}

console.error(
  `Production source size check failed. ${oversizedFiles.length} file(s) exceed ${maxLines} lines:`,
);

for (const file of oversizedFiles) {
  console.error(`- ${relative(rootDir, file.path)}: ${file.lines} lines`);
}

process.exit(1);
