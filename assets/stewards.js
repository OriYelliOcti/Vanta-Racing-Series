/* Stewarding desk.
 *
 * The browser never writes the repository. It authenticates against a bridge
 * application running on the steward's laptop (bridge URL + personal token) and
 * asks that bridge to publish. The token lives in sessionStorage only.
 */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    VRS.shell(cfg, "stewards.html");

    const SESSION = "vrs.bridge.session";
    const decisions = await VRS.json("data/decisions.json");
    const schedule = await VRS.json("data/schedule.json");
    const rounds = (schedule.rounds || []).slice().sort((a, b) => a.round - b.round);

    const loadSession = () => {
      try {
        return JSON.parse(sessionStorage.getItem(SESSION) || "null") || {};
      } catch {
        return {};
      }
    };
    let session = loadSession();

    host.innerHTML = `
      <h1>Stewarding desk</h1>
      <p class="lead">Publish decisions and clips without giving this site write
      access to the repository. The desk talks to the bridge on your own machine;
      the bridge commits. Every action is logged with the name behind the token.</p>

      <div class="grid2">
        <div class="card">
          <h2 style="margin-top:0">Bridge</h2>
          <label class="field"><span>Bridge URL</span>
            <input id="bridgeUrl" placeholder="http://127.0.0.1:8787"
              value="${VRS.esc(session.bridgeUrl || cfg.bridge?.defaultUrl || "http://127.0.0.1:8787")}"></label>
          <label class="field"><span>Personal bridge token</span>
            <input id="bridgeToken" type="password" placeholder="paste your token"
              value="${VRS.esc(session.token || "")}"></label>
          <div class="row">
            <button id="connect">Connect</button>
            <button id="export">Download decisions.json</button>
          </div>
          <div id="bridgeState" style="margin-top:12px"></div>
          <p class="small muted" style="margin-top:12px">The desk never stores the token
          on disk and never sends it anywhere except your bridge.</p>
        </div>

        <div class="card">
          <h2 style="margin-top:0">Publish a decision</h2>
          <div class="grid2">
            <label class="field"><span>Round</span>
              <select id="round">
                ${rounds.map((r) => `<option value="${r.round}">R${r.round} · ${VRS.esc(r.name || r.circuit || "")}</option>`).join("")}
              </select></label>
            <label class="field"><span>Type</span>
              <select id="type">
                <option value="decision">Decision</option>
                <option value="penalty">Penalty</option>
                <option value="investigation">Investigation</option>
                <option value="clip">Clip</option>
              </select></label>
          </div>
          <label class="field"><span>Subject</span>
            <input id="subject" placeholder="Driver, team or incident"></label>
          <label class="field"><span>Ruling</span>
            <textarea id="text" placeholder="What the stewards decided and why"></textarea></label>
          <label class="field"><span>Clip URL (optional)</span>
            <input id="clip" placeholder="https://..."></label>
          <div class="row">
            <button class="primary" id="publish" disabled>Publish through the bridge</button>
            <button id="preview">Preview JSON</button>
          </div>
          <div id="publishState" style="margin-top:12px"></div>
        </div>
      </div>

      <h2>Published decisions</h2>
      <div id="list"></div>

      <h2>Audit log</h2>
      <div id="audit"></div>`;

    const state = (id, message, kind = "ok") => {
      document.getElementById(id).innerHTML = message
        ? `<div class="${kind}">${message}</div>`
        : "";
    };

    function entry() {
      return {
        round: Number(document.getElementById("round").value || 0),
        type: document.getElementById("type").value,
        subject: document.getElementById("subject").value.trim(),
        text: document.getElementById("text").value.trim(),
        clip: document.getElementById("clip").value.trim(),
      };
    }

    function renderList() {
      const list = (decisions.decisions || []).slice().reverse();
      document.getElementById("list").innerHTML = list.length
        ? `<div class="card"><ul class="list">${list
            .map(
              (d) => `<li>
                <div class="spread">
                  <div><span class="chip">R${VRS.esc(d.round)}</span>
                    <b style="margin-left:6px">${VRS.esc(d.subject || "—")}</b>
                    <span class="small muted"> · ${VRS.esc(d.type || "")}</span></div>
                  <span class="small muted">${VRS.esc(d.by || "")} · ${VRS.esc(
                    d.publishedAt ? new Date(d.publishedAt).toLocaleString() : ""
                  )}</span>
                </div>
                <div style="margin-top:4px">${VRS.esc(d.text || "")}</div>
                ${d.clip ? `<a class="small" href="${VRS.esc(d.clip)}" target="_blank" rel="noopener">clip</a>` : ""}
              </li>`
            )
            .join("")}</ul></div>`
        : `<div class="card muted">Nothing published yet.</div>`;
    }

    function renderAudit() {
      const rows = (decisions.audit || []).slice().reverse();
      document.getElementById("audit").innerHTML = rows.length
        ? `<div class="card"><table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
            <tbody>${rows
              .map(
                (a) => `<tr><td class="muted">${VRS.esc(
                  a.at ? new Date(a.at).toLocaleString() : ""
                )}</td><td><b>${VRS.esc(a.actor || "—")}</b></td>
                <td>${VRS.esc(a.action || "")}</td>
                <td class="muted">${VRS.esc(a.target || "")}</td></tr>`
              )
              .join("")}</tbody></table></div>`
        : `<div class="card muted">No audit entries yet.</div>`;
    }

    async function bridgeRequest(path, options = {}) {
      const url = (session.bridgeUrl || "").replace(/\/$/, "") + path;
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token || ""}`,
        ...(options.headers || {}),
      };
      const response = await fetch(url, { ...options, headers });
      const text = await response.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      if (!response.ok) {
        const message = typeof body === "string" ? body : JSON.stringify(body);
        throw new Error(`${response.status} — ${message.slice(0, 200)}`);
      }
      return body;
    }

    document.getElementById("connect").addEventListener("click", async () => {
      session = {
        bridgeUrl: document.getElementById("bridgeUrl").value.trim(),
        token: document.getElementById("bridgeToken").value.trim(),
      };
      sessionStorage.setItem(SESSION, JSON.stringify(session));
      state("bridgeState", "Connecting…", "warn");
      try {
        const who = await bridgeRequest("/whoami", { method: "GET" });
        session.owner = who.owner || "unknown";
        sessionStorage.setItem(SESSION, JSON.stringify(session));
        state("bridgeState", `<b>Connected</b> as ${VRS.esc(session.owner)}.`, "ok");
        document.getElementById("publish").disabled = false;
      } catch (error) {
        state(
          "bridgeState",
          `<b>No bridge.</b> ${VRS.esc(error.message)}<br>
          <span class="small">Start the bridge on the steward laptop, then try again.</span>`,
          "err"
        );
        document.getElementById("publish").disabled = true;
      }
    });

    document.getElementById("preview").addEventListener("click", () => {
      state(
        "publishState",
        `<pre class="small" style="white-space:pre-wrap">${VRS.esc(
          JSON.stringify(entry(), null, 2)
        )}</pre>`
      );
    });

    document.getElementById("publish").addEventListener("click", async () => {
      const payload = entry();
      if (!payload.text) {
        state("publishState", "Write the ruling first.", "err");
        return;
      }
      state("publishState", "Publishing through the bridge…", "warn");
      try {
        const answer = await bridgeRequest("/publish", {
          method: "POST",
          body: JSON.stringify({ kind: "decision", entry: payload }),
        });
        state(
          "publishState",
          `<b>Published.</b> ${
            answer.commit ? `Commit <code>${VRS.esc(answer.commit.slice(0, 7))}</code> · ` : ""
          }logged as ${VRS.esc(answer.owner || session.owner || "unknown")}.`,
          "ok"
        );
        if (answer.decision) decisions.decisions.push(answer.decision);
        if (answer.audit) decisions.audit.push(answer.audit);
        renderList();
        renderAudit();
      } catch (error) {
        state(
          "publishState",
          `<b>Bridge refused.</b> ${VRS.esc(error.message)}<br>
          <span class="small">The repository is untouched.</span>`,
          "err"
        );
      }
    });

    document.getElementById("export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(decisions, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "decisions.json";
      link.click();
    });

    if (session.token) {
      state("bridgeState", "Saved bridge URL found. Press Connect to check it.", "warn");
    }
    renderList();
    renderAudit();
  } catch (error) {
    VRS.fail(host, error);
  }
})();
