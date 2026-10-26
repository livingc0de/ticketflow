import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("VERSION is pinned semver X.Y.Z", () => {
  const v = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();
  assert.match(v, /^\d+\.\d+\.\d+$/);
});
