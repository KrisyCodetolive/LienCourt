const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function refresh() {
  try {
    const r = await fetch("/api/links");
    const { links, total } = await r.json();
    $("rows").innerHTML = links.map((l) =>
      `<div class="row" role="row"><a href="/${l.code}" target="_blank" rel="noopener">${location.host}/${l.code}</a>` +
      `<span class="dest" title="${esc(l.url)}">${esc(l.url)}</span><span class="n">${l.clicks}</span></div>`).join("");
    $("empty").hidden = links.length > 0;
    $("total").textContent = total ? `${total} lien${total > 1 ? "s" : ""} au total` : "";
  } catch { /* le tableau se rafraîchira au prochain passage */ }
}

$("essai").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("error").hidden = true;
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const r = await fetch("/api/links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: $("url").value }) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || "Une erreur est survenue.");
    const href = `${location.origin}/${body.code}`;
    $("short").href = href;
    $("short").textContent = href.replace(/^https?:\/\//, "");
    $("result").hidden = false;
    $("copy").textContent = "Copier";
    refresh();
  } catch (err) {
    $("error").textContent = err.message;
    $("error").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("short").href); $("copy").textContent = "Copié ✓"; }
  catch { $("copy").textContent = "Sélectionnez le lien"; }
});

refresh();
setInterval(refresh, 5000);
