/* The grid: lineups from Discord roles, filtered by division, team and slot. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    const lineups = await VRS.json("data/lineups.json");
    VRS.shell(cfg, "grid.html");

    const SLOTS = cfg.slots || [];
    const teams = lineups.teams || [];

    host.innerHTML = `
      <h1>The grid</h1>
      <p class="lead">Every seat in the league, straight from the Discord roles.
      Lineups refresh every ${cfg.syncHours || 5} hours${
        lineups.generatedAt
          ? ` — last sync <b>${VRS.esc(new Date(lineups.generatedAt).toLocaleString())}</b>`
          : ""
      }.</p>

      <div class="row" style="margin-bottom:16px">
        <label class="field" style="margin:0;min-width:150px"><span>Division</span>
          <select id="fDivision">
            <option value="">All divisions</option>
            ${(cfg.divisions || []).map((d) => `<option value="${VRS.esc(d)}">${VRS.esc(d)}</option>`).join("")}
          </select>
        </label>
        <label class="field" style="margin:0;min-width:190px"><span>Team</span>
          <select id="fTeam"><option value="">All teams</option></select>
        </label>
        <label class="field" style="margin:0;min-width:190px"><span>Slot</span>
          <select id="fSlot"><option value="">All slots</option>
            ${SLOTS.map((s) => `<option value="${VRS.esc(s.key)}">${VRS.esc(s.code)} · ${VRS.esc(s.label)}</option>`).join("")}
          </select>
        </label>
        <label class="field" style="margin:0;min-width:150px"><span>Seats</span>
          <select id="fState">
            <option value="">All</option>
            <option value="open">Open only</option>
            <option value="filled">Filled only</option>
          </select>
        </label>
      </div>

      <div class="stats" id="totals" style="margin-bottom:18px"></div>
      <div class="teams" id="teams"></div>`;

    const divisionSelect = document.getElementById("fDivision");
    const teamSelect = document.getElementById("fTeam");
    const slotSelect = document.getElementById("fSlot");
    const stateSelect = document.getElementById("fState");

    const filledOf = (team, slotKey) => {
      const slot = (team.slots || {})[slotKey] || {};
      return slot.members || [];
    };

    function totals() {
      const rows = SLOTS.map((slot) => {
        const total = teams.length * (slot.capacity || 1);
        const filled = teams.reduce((sum, team) => sum + filledOf(team, slot.key).length, 0);
        return { ...slot, total, filled };
      });
      return rows;
    }

    function renderTotals() {
      document.getElementById("totals").innerHTML = totals()
        .map(
          (slot) => `<div class="stat">
            <b>${slot.filled}/${slot.total}</b>
            <span>${VRS.esc(slot.code)} · ${VRS.esc(slot.label)}</span>
          </div>`
        )
        .join("");
    }

    function renderTeamOptions() {
      const division = divisionSelect.value;
      const options = teams
        .filter((t) => !division || t.division === division)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => `<option value="${VRS.esc(t.key)}">${VRS.esc(t.name)}</option>`)
        .join("");
      teamSelect.innerHTML = `<option value="">All teams</option>${options}`;
    }

    function teamCard(team) {
      const slotFilter = slotSelect.value;
      const state = stateSelect.value;
      const rows = SLOTS.filter((s) => !slotFilter || s.key === slotFilter).map((slot) => {
        const members = filledOf(team, slot.key);
        if (state === "open" && members.length) return "";
        if (state === "filled" && !members.length) return "";
        const who = members.length
          ? members.map((m) => VRS.esc(m.name)).join(", ")
          : "vacant";
        return `<div class="slot">
          <div class="code">${VRS.esc(slot.code)}</div>
          <div class="who ${members.length ? "" : "vacant"}">${who}</div>
        </div>`;
      });
      const body = rows.filter(Boolean).join("");
      if (!body) return "";
      const filled = SLOTS.reduce((sum, s) => sum + filledOf(team, s.key).length, 0);
      return `<article class="card team">
        <div class="head">
          <div class="name">${VRS.esc(team.name)}</div>
          ${VRS.divisionChip(team.division)}
        </div>
        <div class="small muted">${filled} of ${SLOTS.reduce(
          (sum, s) => sum + (s.capacity || 1),
          0
        )} seats filled</div>
        ${body}
      </article>`;
    }

    function render() {
      const division = divisionSelect.value;
      const teamKey = teamSelect.value;
      const list = teams
        .filter((t) => !division || t.division === division)
        .filter((t) => !teamKey || t.key === teamKey)
        .sort((a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name));
      const cards = list.map(teamCard).filter(Boolean).join("");
      document.getElementById("teams").innerHTML =
        cards || `<div class="card muted">No seats match these filters.</div>`;
    }

    divisionSelect.addEventListener("change", () => { renderTeamOptions(); render(); });
    teamSelect.addEventListener("change", render);
    slotSelect.addEventListener("change", render);
    stateSelect.addEventListener("change", render);

    renderTotals();
    renderTeamOptions();
    render();
  } catch (error) {
    VRS.fail(host, error);
  }
})();
