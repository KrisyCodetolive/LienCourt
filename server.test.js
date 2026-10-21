const test = require("node:test");
const assert = require("node:assert");
process.env.DATA_FILE = require("node:path").join(require("node:os").tmpdir(), `liencourt-${process.pid}.json`);
const { server } = require("./server");

test("créer, rediriger et compter", async (t) => {
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.strictEqual((await fetch(`${base}/healthz`)).status, 200);
  assert.strictEqual((await fetch(`${base}/`)).status, 200);

  const bad = await fetch(`${base}/api/links`, { method: "POST", body: JSON.stringify({ url: "javascript:alert(1)" }) });
  assert.strictEqual(bad.status, 400);

  const created = await fetch(`${base}/api/links`, { method: "POST", body: JSON.stringify({ url: "https://example.com/a" }) });
  assert.strictEqual(created.status, 201);
  const { code } = await created.json();
  assert.match(code, /^[a-z0-9]{6}$/);

  const hop = await fetch(`${base}/${code}`, { redirect: "manual" });
  assert.strictEqual(hop.status, 302);
  assert.strictEqual(hop.headers.get("location"), "https://example.com/a");

  const { links } = await (await fetch(`${base}/api/links`)).json();
  assert.strictEqual(links.find((l) => l.code === code).clicks, 1);
  assert.strictEqual((await fetch(`${base}/assets/../server.js`)).status, 404);
});
