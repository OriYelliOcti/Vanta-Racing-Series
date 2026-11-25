/* Announcements published from the FIA desk. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    const news = await VRS.json("data/news.json");
    VRS.shell(cfg, "news.html");

    const items = (news.items || [])
      .slice()
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

    const image = (item) =>
      item.image
        ? `<img src="${VRS.esc(item.image)}" alt="${VRS.esc(item.imageAlt || "")}"
             style="width:100%;height:auto;border-radius:12px;margin:0 0 12px;display:block"
             loading="lazy">`
        : "";

    host.innerHTML = `
      <h1>News</h1>
      <p class="lead">Announcements from the stewards — signings, calendar changes,
      session times and rulings that need more than a line.</p>
      ${
        items.length
          ? items
              .map(
                (item) => `<article class="card" style="margin-bottom:14px">
                  ${image(item)}
                  <h2 style="margin:0 0 6px">${VRS.esc(item.title || "Announcement")}</h2>
                  <p class="small muted" style="margin:0 0 10px">${VRS.esc(
                    String(item.at || "").slice(0, 10)
                  )}${item.by ? ` · ${VRS.esc(item.by)}` : ""}</p>
                  <div style="white-space:pre-wrap">${VRS.esc(item.body || "")}</div>
                </article>`
              )
              .join("")
          : `<div class="card muted">Nothing published yet. The stewards write these in the
             FIA desk.</div>`
      }`;
  } catch (error) {
    VRS.fail(host, error);
  }
})();
