// ---------------------------------------------------------------------------
// Builds a zip of the backend that is safe to hand to a hosting provider,
// a teammate, or CI — and GUARANTEES it never contains:
//   - .env (real secrets)
//   - node_modules (run `npm install` fresh on the target server instead)
//   - local sqlite data files or generated PDF receipts
//   - .git history
//
// Usage:  npm run package:deploy
// Output: dist/future-tech-backend-deploy.zip
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "dist");
const OUT_FILE = path.join(OUT_DIR, "future-tech-backend-deploy.zip");

// Anything matching these is EXCLUDED from the archive, no exceptions.
const EXCLUDE_PATTERNS = [
  ".env",
  ".env.*",
  "!.env.example", // .env.example is fine to include — it has no real secrets
  "node_modules/*",
  ".git/*",
  "data/*.sqlite",
  "receipts/*.pdf",
  "dist/*",
  "*.log",
];

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);

  const zipArgs = ["-r", OUT_FILE, "."];
  EXCLUDE_PATTERNS.forEach((pattern) => {
    zipArgs.push("-x", pattern);
  });

  try {
    execFileSync("zip", zipArgs, { cwd: ROOT, stdio: "inherit" });
  } catch (err) {
    console.error(
      "\n❌ Could not run `zip`. Install it (e.g. `apt-get install zip`) or copy the project files manually, " +
        "making sure to skip: .env, node_modules, .git, data/*.sqlite, receipts/*.pdf\n"
    );
    process.exit(1);
  }

  // Safety check: open the archive back up and confirm no .env file made it in.
  const listing = execFileSync("unzip", ["-l", OUT_FILE]).toString();
  const leaked = listing
    .split("\n")
    .filter((line) => /(^|\/)\.env$/.test(line.trim().split(/\s+/).pop() || ""));

  if (leaked.length > 0) {
    fs.unlinkSync(OUT_FILE);
    console.error("\n❌ .env was about to be included in the deploy package. Aborted and deleted the archive.\n");
    process.exit(1);
  }

  console.log(`\n✅ Deploy package ready: ${path.relative(ROOT, OUT_FILE)}`);
  console.log("   Upload this to your server, then on the server:");
  console.log("     1. Unzip it");
  console.log("     2. Copy .env.example to .env and fill in REAL production values");
  console.log("     3. Run `npm install` fresh on that machine (do not copy node_modules over)");
  console.log("     4. Run `npm start`\n");
}

main();
