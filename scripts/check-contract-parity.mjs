#!/usr/bin/env node
/**
 * check-contract-parity.mjs
 *
 * Verifies that every form field declared in view templates has a
 * corresponding body field read in the route handler, and vice versa.
 *
 * Usage: node scripts/check-contract-parity.mjs
 * Exit 0: all view fields are validated and all validated fields appear in views.
 * Exit 1: mismatch detected (prints diff).
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract all form field names from a view source file.
 * Handles two patterns:
 *   1. HTML attribute: name="fieldname" or name='fieldname'
 *   2. TypeScript: name: "fieldname" property in object literals (input({ name: ... }))
 */
function extractViewFieldNames(source) {
  const names = new Set();

  // HTML attribute: name="fieldname" or name='fieldname'
  const attrPattern = /name=["']([^"']+)["']/g;
  let m;
  while ((m = attrPattern.exec(source)) !== null) {
    names.add(m[1]);
  }

  // TypeScript object property: name: "fieldname" or name: 'fieldname'
  const tsPropPattern = /\bname\s*:\s*["']([^"']+)["']/g;
  while ((m = tsPropPattern.exec(source)) !== null) {
    names.add(m[1]);
  }

  return names;
}

/**
 * Extract form body field reads from a route handler.
 * Patterns matched:
 *   readField(form, "fieldname")        -- FormData helper
 *   body.fieldname                      -- JSON body dot access
 *   body["fieldname"]                   -- JSON body bracket access
 */
function extractRouteFieldReads(source) {
  const names = new Set();

  const readFieldPattern = /readField\s*\(\s*\w+\s*,\s*["']([^"']+)["']/g;
  let m;
  while ((m = readFieldPattern.exec(source)) !== null) {
    names.add(m[1]);
  }

  const bodyDotPattern = /\bbody\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  while ((m = bodyDotPattern.exec(source)) !== null) {
    names.add(m[1]);
  }

  const bodyBracketPattern = /\bbody\s*\[\s*["']([^"']+)["']\s*\]/g;
  while ((m = bodyBracketPattern.exec(source)) !== null) {
    names.add(m[1]);
  }

  return names;
}

/**
 * Extract string literals from a named array constant in a TypeScript file.
 */
function extractArrayLiterals(source, constName) {
  const pattern = new RegExp(
    `const\\s+${constName}\\s*=\\s*\\[([^\\]]+)\\]`,
    "s"
  );
  const match = source.match(pattern);
  if (!match) return new Set();
  const inner = match[1];
  const names = new Set();
  const strPattern = /["']([^"']+)["']/g;
  let m;
  while ((m = strPattern.exec(inner)) !== null) {
    names.add(m[1]);
  }
  return names;
}

function read(relPath) {
  return readFileSync(resolve(ROOT, relPath), "utf8");
}

// ---------------------------------------------------------------------------
// TypeScript primitive component property names -- not HTML form field names
// ---------------------------------------------------------------------------

const TS_PRIMITIVE_PROPS = new Set([
  "label", "type", "required", "value", "placeholder", "hint",
  "autocomplete", "rows", "variant", "name",
  "mode", "action", "title", "intro", "apiKeyRequired", "apiKeyHint",
  "prefill", "email",
]);

// ---------------------------------------------------------------------------
// Per-surface allowlists
// ---------------------------------------------------------------------------

// Fields in the setup view that are intentionally NOT read by the setup route
// (setup only captures required fields; optional fields are managed via admin/save).
const SETUP_VIEW_ONLY_ALLOWLIST = new Set([
  "theme",
  "admin_password",
  "location",
  "linkedin_url",
  "github_url",
  "pdf_cv_url",
  "max_msgs_per_hour",
  "model",
  "daily_budget_usd",
  "accent_color",
]);

// Fields in the admin view that are intentionally NOT read by the admin route.
const ADMIN_VIEW_ONLY_ALLOWLIST = new Set([
  "theme",
  "admin_password",
]);

// Fields read by routes but intentionally absent from config form views.
const SETUP_ROUTE_ONLY_ALLOWLIST = new Set([
  "password",
]);

const ADMIN_ROUTE_ONLY_ALLOWLIST = new Set([
  "password",
]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const adminFormSrc = read("src/views/admin-form.ts");
const setupFormSrc = read("src/views/setup-form.ts");
const adminRouteSrc = read("src/routes/admin.ts");
const setupRouteSrc = read("src/routes/setup.ts");
const configSrc = read("src/types/config.ts");

// REQUIRED_SETUP_FIELDS are validated by the setup route via a loop
const requiredSetupFields = extractArrayLiterals(configSrc, "REQUIRED_SETUP_FIELDS");

// View field extraction
const adminViewFieldsRaw = new Set([
  ...extractViewFieldNames(adminFormSrc),
  ...extractViewFieldNames(setupFormSrc),
]);
const setupViewFieldsRaw = extractViewFieldNames(setupFormSrc);

// Route field extraction
const adminRouteFields = extractRouteFieldReads(adminRouteSrc);
const setupRouteFieldsExplicit = extractRouteFieldReads(setupRouteSrc);
const setupRouteFields = new Set([...setupRouteFieldsExplicit, ...requiredSetupFields]);

// Filter out TS primitive props (not actual HTML field names)
function removeMetaProps(raw) {
  return new Set([...raw].filter((f) => !TS_PRIMITIVE_PROPS.has(f)));
}

const adminViewFields = removeMetaProps(adminViewFieldsRaw);
const setupViewFields = removeMetaProps(setupViewFieldsRaw);

// ---------------------------------------------------------------------------
// Parity checks
// ---------------------------------------------------------------------------

const adminViewOnly = new Set(
  [...adminViewFields].filter(
    (f) => !adminRouteFields.has(f) && !ADMIN_VIEW_ONLY_ALLOWLIST.has(f)
  )
);
const adminRouteOnly = new Set(
  [...adminRouteFields].filter(
    (f) => !adminViewFields.has(f) && !ADMIN_ROUTE_ONLY_ALLOWLIST.has(f)
  )
);

const setupViewOnly = new Set(
  [...setupViewFields].filter(
    (f) => !setupRouteFields.has(f) && !SETUP_VIEW_ONLY_ALLOWLIST.has(f)
  )
);
const setupRouteOnly = new Set(
  [...setupRouteFields].filter(
    (f) => !setupViewFields.has(f) && !SETUP_ROUTE_ONLY_ALLOWLIST.has(f)
  )
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

let hasMismatch = false;

function report(label, viewOnly, routeOnly) {
  const issues = viewOnly.size + routeOnly.size;
  if (issues === 0) {
    console.log(`[OK] ${label}: all fields match`);
    return;
  }
  hasMismatch = true;
  console.error(`[MISMATCH] ${label}:`);
  if (viewOnly.size > 0) {
    console.error(
      `  In view but not in route handler: ${[...viewOnly].sort().join(", ")}`
    );
  }
  if (routeOnly.size > 0) {
    console.error(
      `  In route handler but not in view: ${[...routeOnly].sort().join(", ")}`
    );
  }
}

report("admin (admin-form.ts+setup-form.ts vs routes/admin.ts)", adminViewOnly, adminRouteOnly);
report("setup (setup-form.ts vs routes/setup.ts)", setupViewOnly, setupRouteOnly);

if (hasMismatch) {
  process.exit(1);
}
