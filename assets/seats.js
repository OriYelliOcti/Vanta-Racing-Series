/* Seat board: who sits where, and which seats are still open. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    const lineups = await VRS.json("data/lineups.json");
    const pal = await VRS.palette();
    VRS.shell(cfg, "seats.html");

    const SLOTS = cfg.slots || [];
    const teams = lineups.teams || [];
    const slotApplies = (slot, team) =>
      slot.teams ? slot.teams.includes(team.key) : team.division !== "FIA";
    const slotsFor = (team) => SLOTS.filter((slot) => slotApplies(slot, team));
    const membersOf = (team, key) => ((team.slots || {})[key] || {}).members || [];

    const seatTotal = (team) =>
      slotsFor(team).reduce((n, s) => n + (s.capacity || 1), 0);
    const seatFilled = (team) =>
      slotsFor(team).reduce((n, s) => n + membersOf(team, s.key).length, 0);

    const total = teams.reduce((n, t) => n + seatTotal(t), 0);
    const filled = teams.reduce((n, t) => n + seatFilled(t), 0);
    const racingTeams = teams.filter((t) => t.division === "F1" || t.division === "F2");
    const drivers = racingTeams.reduce((n, t) => n + membersOf(t, "driver").length, 0);
    const ownerless = racingTeams.filter((t) => membersOf(t, "boss").length === 0).length;

    host.innerHTML = `
      <h1>Seat board</h1>
      <p class="lead">Every seat in the league — who holds it and which ones are still
      open. Two drivers per team race; the other nine seats run the team.</p>

      <div class="stats" style="margin-bottom:18px">
        <div class="stat"><b>${filled}/${total}</b><span>seats filled</span></div>
        <div class="stat"><b>${total - filled}</b><span>seats open</span></div>
        <div class="stat"><b>${drivers}</b><span>drivers signed</span></div>
        <div class="stat"><b>${ownerless}</b><span>teams without an owner</span></div>
      </div>

      <div class="row" style="margin-bottom:16px">
        <label class="field" style="margin:0;min-width:150px"><span>Division</span>
          <select id="fDivision">
            <option value="">All divisions</option>
            ${(cfg.divisions || [])
              .map((d) => `<option value="${VRS.esc(d)}">${VRS.esc(d)}</option>`)
              .join("")}
            <option value="FIA">FIA</option>
          </select>
        </label>
        <label class="field" style="margin:0;min-width:170px"><span>Show</span>
          <select id="fState">
            <option value="">Every team</option>
            <option value="open">Teams with open seats</option>
            <option value="full">Teams that are full</option>
          </select>
        </label>
        <span class="pill">Click a team for its page → <b>the grid</b></span>
      </div>

      <div class="seatgrid" id="board"></div>`;

    const divisionSelect = document.getElementById("fDivision");
    const stateSelect = document.getElementById("fState");

    function seatLabel(slot, index, capacity) {
      const seats = slot.seats || [];
      if (seats[index]) return seats[index];
      if (seats.length && capacity > seats.length) return `${seats[0]} ${index + 1}`;
      return `Seat ${index + 1}`;
    }

    function card(team) {
      const own = slotsFor(team);
      const filledHere = seatFilled(team);
      const totalHere = seatTotal(team);
      const lines = [];

      for (const slot of own) {
        const members = membersOf(team, slot.key);
        const capacity = Math.max(slot.capacity || 1, members.length);
        members.forEach((member, i) => {
          lines.push(`<div class="seatline">
            <div class="code">${VRS.esc(slot.code)}</div>
            <div class="role">${VRS.esc(seatLabel(slot, i, capacity))}</div>
            <div class="who">${VRS.esc(member.name)}</div>
          </div>`);
        });
        const open = Math.max(0, capacity - members.length);
        if (open > 0) {
          const label =
            open === 1
              ? seatLabel(slot, members.length, capacity)
              : `${seatLabel(slot, members.length, capacity)} · ${seatLabel(slot, capacity - 1, capacity)}`;
          lines.push(`<div class="seatline">
            <div class="code">${VRS.esc(slot.code)}</div>
            <div class="role">${VRS.esc(label)}</div>
            <div class="who open">${open === 1 ? "open" : `${open} seats open`}</div>
          </div>`);
        }
      }

      const pct = totalHere ? Math.round((filledHere / totalHere) * 100) : 0;
      const color = VRS.colorOf(pal, team.key);
      return `<article class="card seatcard" style="border-top-color:${color}">
        <div class="head">
          <div class="name"><a href="team.html?team=${VRS.esc(team.key)}">${VRS.esc(team.name)}</a>
            <span class="small muted" style="margin-left:6px">${VRS.esc(VRS.codeOf(pal, team.key))}</span></div>
          ${VRS.divisionChip(team.division)}
        </div>
        <div class="count">${filledHere} of ${totalHere} seats filled${
        totalHere - filledHere ? ` · ${totalHere - filledHere} open` : " · full"
      }</div>
        <div class="bar"><i style="width:${pct}%;background:${color}"></i></div>
        ${lines.join("")}
      </article>`;
    }

    function render() {
      const division = divisionSelect.value;
      const state = stateSelect.value;
      const list = teams
        .filter((t) => !division || t.division === division)
        .filter((t) => {
          if (!state) return true;
          const isFull = seatFilled(t) >= seatTotal(t);
          return state === "full" ? isFull : !isFull;
        })
        .sort(
          (a, b) =>
            a.division.localeCompare(b.division) ||
            seatFilled(b) / Math.max(1, seatTotal(b)) - seatFilled(a) / Math.max(1, seatTotal(a)) ||
            a.name.localeCompare(b.name)
        );
      document.getElementById("board").innerHTML =
        list.map(card).join("") ||
        `<div class="card muted">No team matches these filters.</div>`;
    }

    divisionSelect.addEventListener("change", render);
    stateSelect.addEventListener("change", render);
    render();
  } catch (error) {
    VRS.fail(host, error);
  }
})();
