// RosTrick: يقدّم الملف الكبير (apk/aab) المقسّم في rostrick-big/ كملف واحد على /__rostrick_download.<ext>
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = /^\/__rostrick_download\.(apk|aab)$/.exec(url.pathname);
    const pass = () => env.ASSETS.fetch(request);
    if (!m || (request.method !== "GET" && request.method !== "HEAD")) return pass();
    const direct = await pass();
    if (direct.status !== 404) return direct;
    const ext = m[1];
    const get = (p) => env.ASSETS.fetch(new Request(url.origin + "/rostrick-big/" + p));
    const mr = await get("__rostrick_download." + ext + ".parts.json");
    if (!mr.ok) return direct;
    let mf;
    try { mf = await mr.json(); } catch (e) { return direct; }
    const parts = Array.isArray(mf.parts) ? mf.parts : [];
    const total = parts.reduce((a, p) => a + (Number(p.s) || 0), 0);
    if (!parts.length || !total) return direct;
    const headers = new Headers({
      "Content-Type": ext === "apk" ? "application/vnd.android.package-archive" : "application/octet-stream",
      "Content-Length": String(total),
      "Cache-Control": "no-cache"
    });
    if (request.method === "HEAD") return new Response(null, { headers });
    const { readable, writable } = new FixedLengthStream(total);
    ctx.waitUntil((async () => {
      try {
        for (const p of parts) {
          const r = await get(p.f);
          if (!r.ok || !r.body) throw new Error("part " + p.f + " " + r.status);
          await r.body.pipeTo(writable, { preventClose: true });
        }
        await writable.close();
      } catch (e) {
        try { await writable.abort(e); } catch (_) {}
      }
    })());
    return new Response(readable, { headers });
  }
};
