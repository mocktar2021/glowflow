import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { staffJoinLanguageHref } from "../lib/staff-invitations.ts";

test("FR/EN/ES switches preserve the invitation token only in a fragment", async () => {
  const token = "Q".repeat(43);
  const requestedPaths = [];
  const server = createServer((request, response) => {
    requestedPaths.push(request.url);
    response.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    for (const locale of ["fr", "en", "es"]) {
      const href = staffJoinLanguageHref(locale, token);
      const url = new URL(href, `http://127.0.0.1:${address.port}`);
      assert.equal(url.pathname, `/${locale}/join`);
      assert.equal(url.search, "");
      assert.equal(url.hash, `#token=${token}`);
      await new Promise((resolve, reject) => {
        get(url, response => {
          response.resume();
          response.on("end", resolve);
        }).on("error", reject);
      });
    }
    assert.deepEqual(requestedPaths, ["/fr/join", "/en/join", "/es/join"]);
    assert.ok(!requestedPaths.join(" ").includes(token));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
