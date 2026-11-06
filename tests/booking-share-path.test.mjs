import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { bookingSharePath } from "../lib/booking-share-path.ts";

test("owner booking link stays host-independent in French, English, and Spanish", async () => {
  for (const locale of ["fr", "en", "es"]) {
    assert.equal(bookingSharePath(locale, "mocktar-braiding"), `/${locale}/book/mocktar-braiding`);
    assert.equal(bookingSharePath(locale, "salon/other?"), `/${locale}/book/salon%2Fother%3F`);
  }
  const source = await readFile(new URL("../components/glowflow/dashboard-shell.tsx", import.meta.url), "utf8");
  assert.match(source, /<Link href=\{ownerBookingPath\}[^>]*>\s*\{ownerBookingPath\}\s*<\/Link>/);
  assert.doesNotMatch(source, /glowflow\.mocktar\.com/);
});
