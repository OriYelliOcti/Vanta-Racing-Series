/**
 * VRS FIA desk bridge (hosted).
 *
 * Same contract as tools/desk_server.py, but reachable by every steward instead
 * of only the machine that runs it. Publishing commits to the repository through
 * the GitHub API, so the desk needs a token with "Contents: read and write"
 * stored as the GITHUB_TOKEN secret. The page never sees that token.
 *
 *   GET  /health              -> {"ok": true, "configured": true|false, ...}
 *   POST /unlock   {password} -> {"ok": true, "owner": "..."} | 401
 *   POST /publish  {password, kind: "decision", entry: {...}}
 *   POST /publish  {password, kind: "result",
 *                   entry: {round, division, rows: [{pos, driver, team,
 *                            fastestLap?, pole?, note?}]}}
 */

const REPO = "OriYelliOcti/Vanta-Racing-Series";
const BRANCH = "main";
const PAGES = "https://oriyelliocti.github.io";
const TYPES = ["decision", "penalty", "investigation", "clip"];

function allowedOrigin(request) {
  const origin = request.headers.get("Origin") || "";
  if (origin === PAGES) return origin;
  if (origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:")) {
    return origin;
  }
  return "";
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

function reply(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

function owner(env) {
  return (env.DESK_NAME || "FIA Steward").slice(0, 80);
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(String(value).replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function github(env, path, init = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "vrs-desk",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep null */
  }
  if (!response.ok) {
    const message = (body && body.message) || text.slice(0, 160);
    throw new Error(`GitHub ${response.status}: ${message}`);
  }
  return body;
}

async function readJson(env, path) {
  const file = await github(env, `/contents/${path}?ref=${BRANCH}`);
  return { data: JSON.parse(fromBase64(file.content)), sha: file.sha };
}

async function writeJson(env, path, data, message, sha) {
  return github(env, `/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: toBase64(`${JSON.stringify(data, null, 2)}\n`),
      sha,
      branch: BRANCH,
    }),
  });
}

function problemDecision(entry) {
  if (!entry || typeof entry !== "object") return "entry must be an object";
  const number = Number(entry.round);
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    return "round must be between 1 and 99";
  }
  if (!TYPES.includes(entry.type)) return "type must be one of " + TYPES.join(", ");
  const subject = entry.subject ?? "";
  const text = entry.text ?? "";
  const clip = entry.clip ?? "";
  if (typeof subject !== "string" || subject.length > 120) {
    return "subject must be text of at most 120 characters";
  }
  if (typeof text !== "string" || !text.trim()) return "the ruling cannot be empty";
  if (text.length > 4000) return "the ruling is too long (max 4000 characters)";
  if (clip && !(typeof clip === "string" && /^https?:\/\//.test(clip))) {
    return "clip must be an http(s) URL";
  }
  return "";
}

function problemResult(number, division, rows, divisions, teams) {
  if (!divisions.includes(division)) {
    return "division must be one of " + divisions.join(", ");
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 40) {
    return "a result needs between 1 and 40 rows";
  }
  const positions = new Set();
  const drivers = new Set();
  let fastest = 0;
  let poles = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") return "every row must be an object";
    const position = row.pos;
    if (!Number.isInteger(position) || position < 1 || position > 40) {
      return "every row needs a position between 1 and 40";
    }
    if (positions.has(position)) return `position ${position} appears twice`;
    positions.add(position);
    const driver = String(row.driver ?? "").trim();
    if (!driver || driver.length > 80) {
      return "every row needs a driver name (max 80 characters)";
    }
    if (drivers.has(driver.toLowerCase())) return `${driver} appears twice`;
    drivers.add(driver.toLowerCase());
    const team = String(row.team ?? "").trim();
    if (teams.length && !teams.includes(team)) {
      return `unknown ${division} team: ${team || "(none)"}`;
    }
    if (String(row.note ?? "").length > 80) return "notes are limited to 80 characters";
    if (row.fastestLap) fastest += 1;
    if (row.pole) poles += 1;
  }
  const expected = Array.from({ length: rows.length }, (_, index) => index + 1);
  if ([...positions].sort((a, b) => a - b).join(",") !== expected.join(",")) {
    return `positions must run from 1 to ${rows.length} without gaps`;
  }
  if (fastest > 1) return "only one row can have the fastest lap";
  if (poles > 1) return "only one row can have pole";
  return "";
}

function cleanRows(rows) {
  return [...rows]
    .sort((a, b) => a.pos - b.pos)
    .map((row) => {
      const item = {
        pos: Number(row.pos),
        driver: String(row.driver).trim(),
        team: String(row.team).trim(),
      };
      if (row.fastestLap) item.fastestLap = true;
      if (row.pole) item.pole = true;
      const note = String(row.note ?? "").trim();
      if (note) item.note = note;
      return item;
    });
}

async function publishDecision(env, entry) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const decision = {
    round: Number(entry.round),
    type: entry.type,
    subject: String(entry.subject ?? "").trim(),
    text: String(entry.text).trim(),
    clip: String(entry.clip ?? "").trim(),
    by: owner(env),
    publishedAt: now,
  };
  const audit = {
    at: now,
    actor: owner(env),
    action: `publish ${decision.type}`,
    target: `R${decision.round} ${decision.subject || "—"}`,
  };

  const file = await readJson(env, "data/decisions.json");
  file.data.decisions = file.data.decisions || [];
  file.data.audit = file.data.audit || [];
  file.data.decisions.push(decision);
  file.data.audit.push(audit);

  const commit = await writeJson(
    env,
    "data/decisions.json",
    file.data,
    `Publish decision: R${decision.round} ${decision.subject || decision.type}`,
    file.sha
  );

  return {
    ok: true,
    commit: commit.commit.sha,
    owner: owner(env),
    decision,
    audit,
  };
}

function problemNews(entry) {
  if (!entry || typeof entry !== "object") return "entry must be an object";
  const title = String(entry.title ?? "").trim();
  const body = String(entry.body ?? "").trim();
  if (!title) return "the title cannot be empty";
  if (title.length > 140) return "the title is too long (max 140 characters)";
  if (!body) return "the text cannot be empty";
  if (body.length > 6000) return "the text is too long (max 6000 characters)";
  return "";
}

async function publishNews(env, entry) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const item = {
    title: String(entry.title).trim(),
    body: String(entry.body).trim(),
    by: owner(env),
    at: now,
  };
  const file = await readJson(env, "data/news.json");
  file.data.items = file.data.items || [];
  file.data.items.push(item);
  const commit = await writeJson(
    env,
    "data/news.json",
    file.data,
    `Publish news: ${item.title.slice(0, 70)}`,
    file.sha
  );
  return {
    ok: true,
    commit: commit.commit.sha,
    owner: owner(env),
    news: item,
    audit: null,
  };
}

async function publishResult(env, entry) {
  const number = Number(entry.round);
  const division = String(entry.division || "");
  const rows = cleanRows(entry.rows);

  const config = await readJson(env, "data/config.json");
  const divisions = config.data.divisions || ["F1", "F2"];

  const lineups = await readJson(env, "data/lineups.json");
  const teams = (lineups.data.teams || [])
    .filter((team) => team.division === division)
    .map((team) => team.key);

  const why = problemResult(number, division, rows, divisions, teams);
  if (why) {
    const error = new Error(why);
    error.badRequest = true;
    throw error;
  }

  const schedule = await readJson(env, "data/schedule.json");
  const circuit =
    ((schedule.data.rounds || []).find((round) => Number(round.round) === number) || {})
      .circuit || "";
  const name = circuit || `Round ${number}`;

  const file = await readJson(env, "data/results.json");
  file.data.rounds = file.data.rounds || [];
  let target = file.data.rounds.find((round) => Number(round.round) === number);
  if (!target) {
    target = { round: number, name, divisions: {} };
    file.data.rounds.push(target);
  }
  target.name = name;
  delete target.demo;
  target.divisions = target.divisions || {};
  target.divisions[division] = rows;
  file.data.rounds.sort((a, b) => Number(a.round) - Number(b.round));

  const commit = await writeJson(
    env,
    "data/results.json",
    file.data,
    `Publish R${number} ${division} result: ${name}`,
    file.sha
  );

  return {
    ok: true,
    commit: commit.commit.sha,
    owner: owner(env),
    result: { round: number, name, division, rows },
    audit: null,
  };
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, "");

    if (path === "/health" && request.method === "GET") {
      return reply(
        {
          ok: true,
          name: "VRS FIA desk",
          owner: owner(env),
          configured: Boolean(env.GITHUB_TOKEN),
        },
        200,
        origin
      );
    }

    if (request.method !== "POST" || (path !== "/unlock" && path !== "/publish")) {
      return reply({ ok: false, problem: "unknown path" }, 404, origin);
    }

    let payload = null;
    try {
      payload = await request.json();
    } catch {
      payload = null;
    }
    if (!payload) return reply({ ok: false, problem: "invalid JSON body" }, 400, origin);

    const secret = String(payload.password ?? "").trim();
    if (!secret || secret !== (env.DESK_PASSWORD || "")) {
      return reply({ ok: false, problem: "wrong password" }, 401, origin);
    }

    if (path === "/unlock") {
      return reply(
        { ok: true, owner: owner(env), configured: Boolean(env.GITHUB_TOKEN) },
        200,
        origin
      );
    }

    if (!env.GITHUB_TOKEN) {
      return reply(
        {
          ok: false,
          problem:
            "The hosted desk has no GitHub write token yet. Add the GITHUB_TOKEN secret, then publish again.",
        },
        503,
        origin
      );
    }

    const entry = payload.entry || {};
    try {
      if (payload.kind === "decision") {
        const why = problemDecision(entry);
        if (why) return reply({ ok: false, problem: why }, 400, origin);
        return reply(await publishDecision(env, entry), 200, origin);
      }
      if (payload.kind === "result") {
        return reply(await publishResult(env, entry), 200, origin);
      }
      if (payload.kind === "news") {
        const why = problemNews(entry);
        if (why) return reply({ ok: false, problem: why }, 400, origin);
        return reply(await publishNews(env, entry), 200, origin);
      }
      return reply({ ok: false, problem: "unknown kind" }, 400, origin);
    } catch (error) {
      const message = String((error && error.message) || error).slice(0, 300);
      return reply(
        { ok: false, problem: message },
        error && error.badRequest ? 400 : 502,
        origin
      );
    }
  },
};
