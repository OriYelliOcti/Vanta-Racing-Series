/* Calendar: the confirmed circuits, in round order. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    const schedule = await VRS.json("data/schedule.json");
    VRS.shell(cfg, "schedule.html");

    const rounds = (schedule.rounds || []).slice().sort((a, b) => a.round - b.round);
    const note = schedule._note || "Further rounds may be added.";

    host.innerHTML = `
      <h1>Calendar</h1>
      <p class="lead">The ${rounds.length} confirmed rounds of the ${VRS.esc(
        cfg.season || ""
      )} season. Dates and start times are announced in Discord before each
      round; every round runs on the same F1 and F2 weekend format.</p>

      <div class="circuits">
        ${
          rounds.length
            ? rounds
                .map(
                  (r) => `<article class="card circuit">
                    <div class="flag">${VRS.esc(r.flag || "🏁")}</div>
                    <div class="small muted">Round ${VRS.esc(r.round)}</div>
                    <h3>${VRS.esc(r.circuit || "TBA")}</h3>
                    <div class="muted small">${VRS.esc(r.country || "")}</div>
                  </article>`
                )
                .join("")
            : `<div class="card muted">No rounds published yet.</div>`
        }
      </div>

      <p class="small muted" style="margin-top:16px">${VRS.esc(note)}</p>`;
  } catch (error) {
    VRS.fail(host, error);
  }
})();
