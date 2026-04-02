// node-pty ships prebuilt spawn-helper binaries without the execute bit.
// On macOS, node-pty uses posix_spawn() to launch this helper before
// exec-ing the target command. Without +x, posix_spawn fails immediately.
// This postinstall script ensures the helper is executable after npm install.

import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

// npm runs postinstall from the package root, so process.cwd() is correct.
const helperPath = join(
  process.cwd(),
  "node_modules",
  "node-pty",
  "prebuilds",
  `${process.platform}-${process.arch}`,
  "spawn-helper",
);

if (existsSync(helperPath)) {
  chmodSync(helperPath, 0o755);
}
