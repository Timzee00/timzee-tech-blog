import { readdirSync } from "node:fs";
import { join } from "node:path";

const directory = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(directory).filter(name => name.endsWith(".sql"));
const versions = new Map();
const failures = [];
for (const name of files) {
  const match = name.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
  if (!match) {
    failures.push("Invalid migration filename: " + name);
    continue;
  }
  const version = match[1];
  if (versions.has(version)) {
    failures.push("Duplicate version " + version + ": " + versions.get(version) + " and " + name);
  } else versions.set(version, name);
}
if (!files.length) failures.push("No migration files discovered.");
if (failures.length) {
  failures.forEach(message => console.error("Migration validation: " + message));
  process.exitCode = 1;
} else {
  console.log("Migration versions valid: " + files.length + " unique migration files.");
}
