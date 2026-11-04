/* Calendar: circuits, countries, laps and pit windows. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    const schedule = await VRS.json("data/schedule.json");
    VRS.shell(cfg, "schedule.html");

    const rounds = (schedule.rounds || []).slice().sort((a, b) => a.round - b.round);
    const now = Date.now();
    const next = rounds.find((r) => r.date && Date.parse(r.date) >= now);

    host.innerHTML = `
      <h1>Calendar</h1>
      <p class="lead">Every round with its circuit, country, lap count and the pit
      window the stewards will police. Times are the league's local schedule.</p>
      ${
        next
          ? `<div class="card" style="margin-bottom:18px">
              <div class="spread">
                <div>
                  <div class="small muted">Next round</div>
                  <h3 style="font-size:20px;margin:2px 0 4px">R${VRS.esc(next.round)} · ${VRS.esc(
                    next.name || next.circuit
                  )}</h3>
                  <div class="muted">${VRS.esc(next.circuit || "")} · ${VRS.esc(
                    next.country || ""
                  )} · ${VRS.esc(next.laps || "—")} laps</div>
                </div>
                <div class="pill">Pit window <b>${VRS.esc(next.pitWindow || "—")}</b></div>
              </div>
            </div>`
          : ""
      }
      <div class="card">
        <table>
          <thead><tr><th class="pos">R</th><th>Grand Prix</th><th>Circuit</th>
          <th>Country</th><th class="num">Laps</th><th>Pit window</th><th>Date</th></tr></thead>
          <tbody>
            ${
              rounds.length
                ? rounds
                    .map(
                      (r) => `<tr>
                        <td class="pos">${VRS.esc(r.round)}</td>
                        <td><b>${VRS.esc(r.name || "—")}</b></td>
                        <td class="muted">${VRS.esc(r.circuit || "—")}</td>
                        <td class="muted">${VRS.esc(r.country || "—")}</td>
                        <td class="num">${VRS.esc(r.laps || "—")}</td>
                        <td class="muted">${VRS.esc(r.pitWindow || "—")}</td>
                        <td class="muted">${VRS.esc(r.date || "TBA")}</td></tr>`
                    )
                    .join("")
                : `<tr><td colspan="7" class="muted">No rounds published yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      <p class="small muted" style="margin-top:12px">Pit windows are written as
      "lap a–b", so the stewards can check a stop against the published window.</p>`;
  } catch (error) {
    VRS.fail(host, error);
  }
})();
