// Turns the production build into a static folder + zip that itch.io accepts.
// - copies dist/client/_shell.html to index.html (itch requires index.html)
// - rewrites root-absolute asset URLs to relative ones
// - zips everything into dist/blockcraft-2d-itch.zip
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const clientDir = path.resolve("dist/client");
const shell = path.join(clientDir, "_shell.html");

if (!fs.existsSync(shell)) {
  console.error("Missing dist/client/_shell.html — run `npm run build` first.");
  process.exit(1);
}

let html = fs.readFileSync(shell, "utf8");
html = html
  .replace(/(["'(])\/\.\//g, "$1./")
  .replace(/(["'(])\/assets\//g, "$1./assets/")
  .replace(/(["'(])\/favicon\.ico/g, "$1./favicon.ico");

fs.writeFileSync(path.join(clientDir, "index.html"), html);
fs.rmSync(shell, { force: true });

const zipPath = path.resolve("dist/blockcraft-2d-itch.zip");
fs.rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: clientDir, stdio: "inherit" });

console.log(`Itch.io package ready: ${path.relative(process.cwd(), zipPath)}`);
