import { execFileSync } from "node:child_process";

// Netlify runs this before dependency installation (its ignore runtime may be
// Node 18). Exit 0 stops a Git-triggered build; exit 1 allows it to continue.
// Read only the subject so a quoted marker in a PR description cannot suppress
// an ordinary merge. Build hooks may bypass Netlify's ignore command.
try {
  const subject = execFileSync("git", ["log", "-1", "--format=%s", process.env.COMMIT_REF || "HEAD"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
  const skip = /\[skip netlify\]/i.test(subject);
  console.log(skip ? "Skipping the requested review build." : "No build-skip marker; continuing.");
  process.exitCode = skip ? 0 : 1;
} catch {
  // Missing history must not accidentally suppress a real release.
  console.log("Could not inspect the commit subject; continuing the build.");
  process.exitCode = 1;
}
