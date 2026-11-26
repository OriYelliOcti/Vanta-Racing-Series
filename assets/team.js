/* One team: seats, people, budget and results. Reads only JSON. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    const lineups = await VRS.json("data/lineups.json");
    const results = await VRS.json("data/results.json");
    const budget = await VRS.json("data/budget.json").catch(() => null);
    const profiles = (await VRS.json("data/profiles.json").catch(() => ({}))).users || {};
    const pal = await VRS.palette();
    VRS.shell(cfg, "grid.html");

    const key = new URLSearchParams(location.search).get("team") || "";
    const team = (lineups.teams || []).find((t) => t.key === key);
    if (!team) {
      host.innerHTML = `<div class="err"><b>No such team.</b> Open it from
        <a href="grid.html">the grid</a>.</div>`;
      return;
    }

    const money = (value) =>
      "£" + (Math.round((Number(value) || 0) / 1000) / 1000).toFixed(1) + "M";
    const seats = (cfg.slots || []).filter((slot) =>
      team.division === "FIA"
        ? ["president", "assistants", "directors", "safety", "stewards"].includes(slot.key)
        : ["boss", "principal", "engineer", "driver", "reserve", "crew"].includes(slot.key)
    );

    // Race number and nationality from the bot's profiles.json, same as on the grid.
    const profileLine = (member) => {
      const row = profiles[String(member && member.id)] || {};
      const bits = [];
      if (row.number) bits.push(`#${VRS.esc(row.number)}`);
      if (row.nationality) bits.push(VRS.esc(row.nationality));
      return bits.length ? ` <span class="small muted">${bits.join(" · ")}</span>` : "";
    };

    const seatLabel = (slot, index) =>
      (slot.seats || [])[index] ||
      ((slot.seats || []).length === 1 ? `${slot.seats[0]} ${index + 1}` : `Seat ${index + 1}`);

    const rows = [];
    let filled = 0;
    let capacity = 0;
    for (const slot of seats) {
      const members = (((team.slots || {})[slot.key] || {}).members) || [];
      const size = Math.max(slot.capacity || 1, members.length);
      capacity += size;
      members.forEach((member, index) => {
        filled += 1;
        rows.push(`<div class="slot">
          <div class="code">${VRS.esc(slot.code)}</div>
          <div class="seat">${VRS.esc(seatLabel(slot, index))}</div>
          <div class="who">${VRS.esc(member.name)}${profileLine(member)}</div>
        </div>`);
      });
      const open = size - members.length;
      if (open > 0) {
        rows.push(`<div class="slot">
          <div class="code">${VRS.esc(slot.code)}</div>
          <div class="seat">${VRS.esc(
            open === 1 ? seatLabel(slot, members.length) : `${seatLabel(slot, members.length)} · ${seatLabel(slot, size - 1)}`
          )}</div>
          <div class="who vacant">${open === 1 ? "vacant" : `${open} seats open`}</div>
        </div>`);
      }
    }

    const standings = VRS.computeStandings(results.rounds || [], cfg, team.division);
    const teamRow = standings.teams.find((row) => row.team === team.key) || {};
    const drivers = Object.values(team.slots || {})
      .flatMap((slot) => slot.members || [])
      .map((member) => {
        const scored = standings.drivers.find((row) => row.driver === member.name) || {};
        const seat = profileLine(member).trim();
        return {
          name: member.name,
          seat,
          points: scored.points || 0,
          starts: scored.starts || 0,
          wins: scored.wins || 0,
          podiums: scored.podiums || 0,
          best: scored.best === 99 ? "—" : scored.best || "—",
        };
      })
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    const budgetRow = (budget && (budget.teams || {})[team.key]) || null;
    const color = VRS.colorOf(pal, team.key);
    const raced = (results.rounds || [])
      .map((round) => ({
        round: round.round,
        name: round.name || "",
        rows: (((round.divisions || {})[team.division] || []) || []).filter(
          (row) => row.team === team.key
        ),
      }))
      .filter((round) => round.rows.length);

    host.innerHTML = `
      <p class="small muted"><a href="grid.html">← The grid</a> ·
        <a href="seats.html">Seat board</a></p>
      <div class="card" style="border-top:4px solid ${color};background:linear-gradient(180deg, ${color}22 0%, var(--panel) 42%, var(--panel-2) 100%)">
        <div class="teamhead">
          <h1 style="margin:0">${VRS.esc(team.name)}
            <span class="small muted" style="font-weight:400;letter-spacing:1px;vertical-align:middle;margin-left:8px">${VRS.esc(
              VRS.codeOf(pal, team.key)
            )}</span></h1>
          ${VRS.divisionChip(team.division)}
        </div>
        <p class="small muted" style="margin:8px 0 0">${filled} of ${capacity} seats filled${
          capacity - filled ? ` · <b>${capacity - filled} open</b>` : " · full"
        }${budgetRow ? ` · ${money(budgetRow.budget)} left · ${money(budgetRow.spent)} spent` : ""}</p>
        <div style="margin-top:12px">${rows.join("")}</div>
        ${
          capacity - filled
            ? `<p class="small" style="margin:12px 0 0"><a class="btn primary" href="${VRS.esc(
                cfg.discordInvite || "#"
              )}" target="_blank" rel="noopener">Apply for a seat</a>
               <span class="muted" style="margin-left:8px">post in #signings</span></p>`
            : ""
        }
      </div>

      <div class="grid2">
        <div class="card">
          <h2 style="margin-top:0">Drivers</h2>
          ${
            drivers.length
              ? `<table><thead><tr><th>Driver</th><th class="num">Pts</th><th class="num">Starts</th>
                 <th class="num">Wins</th><th class="num">Podiums</th><th class="num">Best</th></tr></thead>
                 <tbody>${drivers
                   .map(
                     (d) => `<tr><td>${VRS.esc(d.name)}${d.seat ? ` ${d.seat}` : ""}</td><td class="num"><b>${d.points}</b></td>
                       <td class="num">${d.starts}</td><td class="num">${d.wins}</td>
                       <td class="num">${d.podiums}</td><td class="num">${d.best}</td></tr>`
                   )
                   .join("")}</tbody></table>`
              : `<p class="muted">No drivers signed yet.</p>`
          }
        </div>
        <div class="card">
          <h2 style="margin-top:0">Season</h2>
          <div class="stats">
            <div class="stat"><b>${teamRow.points || 0}</b><span>constructor points</span></div>
            <div class="stat"><b>${teamRow.wins || 0}</b><span>wins</span></div>
            <div class="stat"><b>${standings.rounds || 0}</b><span>rounds scored</span></div>
          </div>
          ${
            raced.length
              ? `<table style="margin-top:14px"><thead><tr><th>Round</th><th>Driver</th>
                 <th class="num">Pos</th><th class="num">Pts</th></tr></thead><tbody>${raced
                   .map((round) =>
                     round.rows
                       .map(
                         (row) => `<tr><td>R${round.round} ${VRS.esc(round.name)}</td>
                           <td>${VRS.esc(row.driver)}</td><td class="num">${row.pos}</td>
                           <td class="num">${VRS.rowPoints(row, cfg)}</td></tr>`
                       )
                       .join("")
                   )
                   .join("")}</tbody></table>`
              : `<p class="muted" style="margin-top:12px">No results yet — the tables fill
                 when a steward publishes a race.</p>`
          }
        </div>
      </div>`;
  } catch (error) {
    VRS.fail(host, error);
  }
})();
