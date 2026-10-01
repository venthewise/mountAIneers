const $ = (id) => document.getElementById(id);
const UI_KEY = "mountaineers-ui";

let snap = null;
let editingId = null;

function isPixelUi() {
  return document.documentElement.dataset.ui === "pixel63";
}

function applyUi(ui) {
  const pixel = ui === "pixel63";
  if (pixel) document.documentElement.dataset.ui = "pixel63";
  else delete document.documentElement.dataset.ui;
  try {
    localStorage.setItem(UI_KEY, pixel ? "pixel63" : "field");
  } catch (_) {}
  document.querySelectorAll("input[name=ui-skin]").forEach((r) => {
    r.checked = r.value === (pixel ? "pixel63" : "field");
  });
  if (snap?.expedition) drawMap();
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function siteById(id) {
  return snap?.peak.sites.find((s) => s.id === id);
}

function drawMap() {
  const svg = $("map");
  if (!snap?.expedition) return;
  const pixel = isPixelUi();
  const sites = snap.peak.sites;
  const phase = snap.expedition.clock.phase;
  const sky = snap.expedition.weather.sky;
  const skyFill = pixel
    ? sky === "storm"
      ? "#1a0828"
      : sky === "snow"
        ? "#2a1850"
        : sky === "wind"
          ? "#241040"
          : "#3a1480"
    : sky === "storm"
      ? "#15181c"
      : sky === "snow"
        ? "#1a2730"
        : sky === "wind"
          ? "#1a242c"
          : "#17303a";
  const skyEnd = pixel ? "#14081e" : "#0c1114";
  const pts = sites.map((s) => `${s.x},${s.y}`).join(" ");
  const ridge = `M 0 640 L 0 490 L 70 430 L 150 340 L 250 250 L 360 150 L 470 70 L 540 18 L 610 55 L 680 130 L 720 190 L 720 640 Z`;
  const snow = `M 470 70 L 540 18 L 610 55 L 580 90 L 520 110 Z`;
  const ink = pixel ? "#14081e" : "#0c1114";
  const paper = pixel ? "#fff3c4" : "#e8e2d4";
  const mute = pixel ? "#c9a6ff" : "#9aa6ae";
  const lantern = pixel ? "#ffcc33" : "#e2a54a";
  const blood = pixel ? "#ff3366" : "#c45c4a";
  const glacier = pixel ? "#33fff0" : "#8fd0c8";
  const ridgeFill = pixel ? "#2a1048" : "#1b262e";
  const snowFill = pixel ? "#fff3c4" : "#dfe7ea";
  const labelFont = pixel ? "VT323, monospace" : "Fraunces";
  const monoFont = pixel ? "VT323, monospace" : "IBM Plex Mono";
  const climberFont = pixel ? "Press Start 2P, monospace" : "IBM Plex Sans";

  const climbers = snap.expedition.climbers.filter((c) => c.alive);
  const occupancy = {};
  for (const c of climbers) {
    occupancy[c.location] = occupancy[c.location] || [];
    occupancy[c.location].push(c);
  }

  let people = "";
  for (const [loc, group] of Object.entries(occupancy)) {
    const s = siteById(loc);
    if (!s) continue;
    group.forEach((c, i) => {
      const dx = (i - (group.length - 1) / 2) * 16;
      const dy = i % 2 === 0 ? -10 : 8;
      const initials = c.name.slice(0, 2).toUpperCase();
      const body = pixel
        ? `<rect x="-8" y="-8" width="16" height="16" fill="${c.color}" stroke="${ink}" stroke-width="2"/>
        <text y="4" text-anchor="middle" font-size="6" font-family="${climberFont}" fill="${ink}">${initials}</text>`
        : `<circle r="9" fill="${c.color}" stroke="${ink}" stroke-width="2"/>
        <text y="3" text-anchor="middle" font-size="8" font-family="${climberFont}" fill="${ink}" font-weight="600">${initials}</text>`;
      people += `<g class="map-climber" data-id="${c.id}" transform="translate(${s.x + dx} ${s.y + dy})">${body}</g>`;
    });
  }

  const camps = sites
    .map((s) => {
      const death = s.alt >= snap.peak.deathZoneAlt;
      const cache = snap.expedition.caches[s.id];
      const cacheNote =
        cache.o2 || cache.food
          ? `<text x="${s.x + 14}" y="${s.y + 22}" fill="${glacier}" font-size="${pixel ? 12 : 9}" font-family="${monoFont}">o2 ${cache.o2} · food ${cache.food}</text>`
          : "";
      const mark = pixel
        ? `<rect x="${s.x - (s.id === "summit" ? 7 : 5)}" y="${s.y - (s.id === "summit" ? 7 : 5)}" width="${s.id === "summit" ? 14 : 10}" height="${s.id === "summit" ? 14 : 10}" fill="${death ? blood : lantern}" stroke="${paper}" stroke-width="2"/>`
        : `<circle cx="${s.x}" cy="${s.y}" r="${s.id === "summit" ? 7 : 5.5}" fill="${death ? blood : lantern}" stroke="${paper}" stroke-width="1.2"/>`;
      return `<g>
        ${mark}
        <text x="${s.x - (pixel ? 16 : 12)}" y="${s.y - (pixel ? 18 : 14)}" fill="${paper}" font-size="${pixel ? 14 : 11}" font-family="${labelFont}" text-anchor="end">${s.name}</text>
        <text x="${s.x - (pixel ? 16 : 12)}" y="${s.y - (pixel ? 4 : 2)}" fill="${mute}" font-size="${pixel ? 12 : 9}" font-family="${monoFont}" text-anchor="end">${s.alt} m</text>
        ${cacheNote}
      </g>`;
    })
    .join("");

  const contours = pixel
    ? `<rect x="80" y="450" width="560" height="140" fill="none" stroke="#5a1c88" stroke-width="3" opacity="0.55"/>
    <rect x="200" y="330" width="400" height="96" fill="none" stroke="#5a1c88" stroke-width="3" opacity="0.5"/>
    <rect x="340" y="198" width="260" height="64" fill="none" stroke="#7a2040" stroke-width="3" opacity="0.6"/>`
    : `<ellipse cx="360" cy="520" rx="280" ry="70" fill="none" stroke="#2a3a42" stroke-dasharray="3 8" opacity="0.5"/>
    <ellipse cx="400" cy="380" rx="200" ry="48" fill="none" stroke="#2a3a42" stroke-dasharray="3 8" opacity="0.45"/>
    <ellipse cx="470" cy="230" rx="130" ry="32" fill="none" stroke="#3a2a2a" stroke-dasharray="3 8" opacity="0.55"/>`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${skyFill}"/>
        <stop offset="100%" stop-color="${skyEnd}"/>
      </linearGradient>
    </defs>
    <rect width="720" height="640" fill="url(#sky)"/>
    ${contours}
    <path d="${ridge}" fill="${ridgeFill}"/>
    <path d="${snow}" fill="${snowFill}" opacity="0.85"/>
    <polyline points="${pts}" fill="none" stroke="${lantern}" stroke-width="${pixel ? 4 : 2.4}" stroke-dasharray="${pixel ? "8 8" : "7 6"}" stroke-linecap="${pixel ? "square" : "round"}"/>
    ${camps}
    ${people}
    <text x="24" y="36" fill="${mute}" font-size="${pixel ? 16 : 11}" font-family="${monoFont}">${phase} · ${sky}</text>
  `;
  document.body.classList.remove("night", "dawn", "day", "dusk");
  document.body.classList.add(phase);
}

function styleOptions(selected) {
  const styles = [
    ["serac", "patient alpinist"],
    ["cornice", "summit pusher"],
    ["scree", "siege porter"],
  ];
  return styles
    .map(([id, label]) => `<option value="${id}"${selected === id ? " selected" : ""}>${label}</option>`)
    .join("");
}

function rosterDetail(r) {
  if (r.provider === "external") return "MCP / REST";
  if (r.provider === "heuristic") return `heuristic · ${r.persona || "alpinist"}`;
  return `${r.provider} ${r.model || ""}`.trim();
}

function isProfileField(el) {
  if (!el || !el.closest) return false;
  const tag = el.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return false;
  return Boolean(el.closest("form[data-profile]"));
}

function renderLobby() {
  const roster = snap.lobby.roster;
  $("roster-empty").hidden = roster.length > 0;
  $("btn-start").disabled = !snap.lobby.canStart;
  $("mcp-url").textContent = `${location.origin}/mcp`;
  if (editingId && !roster.some((r) => r.id === editingId)) editingId = null;
  const rosterEl = $("roster");
  if (editingId && isProfileField(document.activeElement)) return;
  rosterEl.innerHTML = roster
    .map((r) => {
      const editing = editingId === r.id;
      const actions =
        snap.phase === "lobby"
          ? `<div class="rope-actions">
              <button type="button" data-edit="${r.id}">${editing ? "close" : "edit"}</button>
              <button type="button" data-remove="${r.id}">remove</button>
            </div>`
          : "";
      const styleField =
        r.provider === "heuristic"
          ? `<select name="style">${styleOptions(r.style || "serac")}</select>`
          : "";
      const form = editing
        ? `<form class="profile-edit stack" data-profile="${r.id}">
        <input name="name" maxlength="24" value="${escapeHtml(r.name)}" />
        ${styleField}
        <textarea name="standingOrders" maxlength="1000" rows="3" placeholder="Standing orders — pinned on every briefing">${escapeHtml(r.standingOrders || "")}</textarea>
        <button type="submit">Save profile</button>
      </form>`
        : "";
      const ordersNote = r.standingOrders ? `<small style="display:block;color:#8fd0c8">orders pinned</small>` : "";
      return `<li>
        <span class="swatch" style="background:${r.color};width:.7rem;height:.7rem;border-radius:50%;display:inline-block"></span>
        <div><strong>${escapeHtml(r.name)}</strong><small style="display:block;color:#9aa6ae">${escapeHtml(rosterDetail(r))}</small>${ordersNote}</div>
        ${actions}
        ${form}
      </li>`;
    })
    .join("");
}

function renderGenerating() {
  const exp = snap.expedition;
  const box = $("gen-factors");
  if (!exp) {
    box.innerHTML = "";
    return;
  }
  const w = exp.weather;
  const rows = [
    ["seed", String(exp.seed)],
    ["sky", w.sky],
    ["temperature", `${w.tempC}°C`],
    ["wind", `${w.windKph} kph`],
    ["window", w.window],
    ["icefall", exp.hazards ? "live" : "held"],
    ["death zone", `${snap.peak.deathZoneAlt} m`],
    ["season", `${exp.maxTurns} turns`],
    ["rope", exp.climbers.map((c) => c.name).join(", ")],
  ];
  box.innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join("");
}

function renderBoard() {
  const exp = snap.expedition;
  if (!exp) return;
  $("turn").textContent = `${exp.turn} / ${exp.maxTurns}`;
  $("clock").textContent = `d${exp.clock.day} ${exp.clock.phase}`;
  $("seed").textContent = String(exp.seed);
  $("sky").textContent = exp.weather.sky.toUpperCase();
  $("wxline").textContent = `${exp.weather.tempC}°C · ${exp.weather.windKph} kph · window ${exp.weather.window}`;
  $("weather").className = `weather ${exp.weather.sky}`;

  if (snap.phase === "generating") {
    $("status-line").textContent = "Surveying the ridge. Agents wait until the season is stamped.";
  } else if (snap.phase === "ended") {
    const names = (exp.outcome?.winnerIds || [])
      .map((id) => exp.climbers.find((c) => c.id === id)?.name)
      .filter(Boolean)
      .join(", ");
    $("status-line").textContent = `Ended — ${exp.outcome?.endedReason || "season over"}${names ? `. Summits: ${names}` : ""}`;
  } else {
    $("status-line").textContent = `${exp.living} agents on Thalun. ${exp.committedIds.length} committed this turn.`;
  }

  renderClimberCards();
  renderTalk();

  $("log").innerHTML = exp.log
    .slice()
    .reverse()
    .map((e) => `<li class="${e.type}"><span class="t">T${e.turn}</span>${escapeHtml(e.message)}</li>`)
    .join("");

  drawMap();
  renderCountdown();
}

function renderTalk() {
  const host = $("ridge-talk");
  if (!host) return;
  const exp = snap?.expedition;
  const lines = exp?.talk?.length
    ? exp.talk
    : (exp?.climbers || [])
        .filter((c) => c.lastSay)
        .map((c) => ({
          turn: exp.turn,
          name: c.name,
          color: c.color,
          text: c.lastSay,
          specs: c.lastSpecs,
        }));
  if (!lines.length) {
    host.innerHTML = `<li class="empty">Nobody has spoken yet.</li>`;
    return;
  }
  host.innerHTML = lines
    .map((t) => {
      const specs = t.specs
        ? `<p class="talk-specs">${escapeHtml(t.specs)}</p>`
        : "";
      return `<li class="talk-line">
        <span class="swatch" style="background:${t.color}"></span>
        <div>
          <div class="talk-who"><strong>${escapeHtml(t.name)}</strong><span>T${t.turn}</span></div>
          <p class="talk-text">${escapeHtml(t.text)}</p>
          ${specs}
        </div>
      </li>`;
    })
    .join("");
  host.scrollTop = host.scrollHeight;
}

function climberStats(climber, exp) {
  const site = siteById(climber.location);
  const death = (site?.alt || 0) >= (snap.peak.deathZoneAlt || 7500);
  const rows = [];

  let energyTone = "";
  let energyText = `${climber.energy}/100`;
  if (climber.energy <= 0) {
    energyTone = "bad";
    energyText = `0/100 — cannot climb until they rest`;
  } else if (climber.energy < 30) {
    energyTone = "bad";
    energyText = `${climber.energy}/100 — exhausted`;
  } else if (climber.energy < 50) {
    energyTone = "warn";
    energyText = `${climber.energy}/100 — tiring`;
  }
  rows.push(["Energy", energyText, energyTone]);

  let foodTone = "";
  let foodText = `${climber.food} ${climber.food === 1 ? "meal" : "meals"}`;
  if (climber.food <= 0) {
    foodTone = "bad";
    foodText = `0 meals — starving ${climber.starve}/3`;
  } else if (climber.food < 3) {
    foodTone = "warn";
    foodText = `${foodText} — running low`;
  }
  rows.push(["Food", foodText, foodTone]);

  const bottles = `${climber.o2} ${climber.o2 === 1 ? "bottle" : "bottles"}`;
  let o2Tone = "";
  let o2Text = bottles;
  if (death && climber.o2 < 1) {
    o2Tone = "bad";
    o2Text = `0 bottles in the death zone`;
  } else if (death) {
    o2Tone = "warn";
    o2Text = `${bottles} — one spent each turn here`;
  }
  rows.push(["Oxygen", o2Text, o2Tone]);

  let amsTone = "";
  let amsText = `${climber.ams}/3`;
  if (climber.ams >= 2) {
    amsTone = "bad";
    amsText = `${climber.ams}/3 — one more strike and they die`;
  } else if (climber.ams > 0) {
    amsTone = "warn";
    amsText = `${climber.ams}/3 — from time high without oxygen`;
  }
  rows.push(["Altitude sickness", amsText, amsTone]);

  const atIce = site?.id === "c1";
  let iceTone = "";
  let iceText = "not on Camp 1";
  if (atIce && climber.energy < 35) {
    iceTone = "bad";
    iceText = `on the icefall with ${climber.energy} stamina`;
  } else if (atIce) {
    iceTone = "warn";
    iceText = `on the icefall · ${exp.weather.sky}`;
  }
  rows.push(["Icefall", iceText, iceTone]);

  let frostTone = "";
  let frostText = `${climber.frostbite}/3`;
  if (climber.frostbite >= 2) {
    frostTone = "bad";
    frostText = `${climber.frostbite}/3 — one more strike and they die`;
  } else if (death && exp.weather.sky === "storm") {
    frostTone = "warn";
    frostText = `${climber.frostbite}/3 — high in a storm`;
  }
  rows.push(["Frostbite", frostText, frostTone]);

  let seasonTone = "";
  let seasonText = `turn ${exp.turn}/${exp.maxTurns}`;
  if (climber.hasSummit) seasonText += " · has summit tag";
  if (!climber.alive) {
    seasonTone = "bad";
    seasonText = `died (${climber.cause || "the mountain"})`;
  } else if (climber.hasSummit && site?.id === "bc") {
    seasonText = "summit and home — a win";
  }
  rows.push(["Season", seasonText, seasonTone]);

  return { site, rows };
}

function renderClimberCards() {
  const host = $("climber-cards");
  const exp = snap?.expedition;
  if (!exp) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = exp.climbers
    .slice()
    .sort((a, b) => (siteById(b.location)?.alt || 0) - (siteById(a.location)?.alt || 0))
    .map((c) => {
      const { site, rows } = climberStats(c, exp);
      const err = snap.lobby.roster.find((r) => r.name === c.name)?.lastError;
      const tag = c.hasSummit ? " ▲" : "";
      const where = c.alive
        ? `${c.persona || c.kind} · ${site?.name || c.location}${site ? ` · ${site.alt} m` : ""}`
        : `Off the mountain — ${c.cause || "gone"}.`;
      const last = c.lastResult
        ? `<p class="card-last">${escapeHtml(c.lastResult)}${err ? " · " + escapeHtml(err) : ""}</p>`
        : err
          ? `<p class="card-last">${escapeHtml(err)}</p>`
          : "";
      const stats = rows
        .map(
          ([topic, text, tone]) =>
            `<div><dt>${escapeHtml(topic)}</dt><dd class="live${tone ? " " + tone : ""}">${escapeHtml(text)}</dd></div>`,
        )
        .join("");
      return `<article class="roster-card${c.alive ? "" : " dead"}" style="--swatch:${c.color}">
        <h2>${escapeHtml(c.name)}${tag}</h2>
        <p class="lede">${escapeHtml(where)}</p>
        ${last}
        <dl class="survival-list">${stats}</dl>
      </article>`;
    })
    .join("");
}

function renderCountdown() {
  const el = $("countdown");
  if (!snap?.turnEndsAt || snap.phase !== "climbing") {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const left = Math.max(0, snap.turnEndsAt - Date.now());
  const pct = Math.max(0, Math.min(1, left / snap.turnMs));
  $("barfill").style.transform = `scaleX(${pct})`;
  $("countdown-label").textContent = `${Math.ceil(left / 1000)}s on the clock`;
}

function render() {
  if (!snap) return;
  const lobby = snap.phase === "lobby";
  $("lobby").hidden = !lobby;
  $("season").hidden = lobby;
  $("generating").hidden = snap.phase !== "generating";
  $("generating").classList.toggle("is-on", snap.phase === "generating");
  if (lobby) {
    renderLobby();
  } else {
    renderBoard();
    if (snap.phase === "generating") renderGenerating();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

$("form-heuristic").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/lobby/climbers", {
      method: "POST",
      body: JSON.stringify({
        name: fd.get("name"),
        provider: "heuristic",
        style: fd.get("style"),
        standingOrders: fd.get("standingOrders") || undefined,
      }),
    });
    e.target.reset();
    $("heuristic-style").value = "serac";
  } catch (err) {
    alert(err.message);
  }
});

$("btn-team").addEventListener("click", async () => {
  try {
    await api("/api/lobby/team", { method: "POST", body: "{}" });
  } catch (err) {
    alert(err.message);
  }
});

$("form-llm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/lobby/climbers", {
      method: "POST",
      body: JSON.stringify({
        name: fd.get("name"),
        provider: fd.get("provider"),
        model: fd.get("model"),
        apiKey: fd.get("apiKey"),
        baseUrl: fd.get("baseUrl") || undefined,
        standingOrders: fd.get("standingOrders") || undefined,
      }),
    });
    e.target.reset();
    $("llm-model").value = "grok-4.3";
    syncLlmForm();
  } catch (err) {
    alert(err.message);
  }
});

$("roster").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit]");
  if (editBtn) {
    const editId = editBtn.dataset.edit;
    editingId = editingId === editId ? null : editId;
    renderLobby();
    const form = document.querySelector(`form[data-profile="${editingId}"]`);
    const field = form?.querySelector("textarea[name=standingOrders]") || form?.querySelector("input, select");
    field?.focus();
    return;
  }
  const removeBtn = e.target.closest("[data-remove]");
  const id = removeBtn?.dataset?.remove;
  if (!id) return;
  try {
    if (editingId === id) editingId = null;
    await api(`/api/lobby/climbers/${id}`, { method: "DELETE" });
  } catch (err) {
    alert(err.message);
  }
});

$("roster").addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-profile]");
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  try {
    await api(`/api/lobby/climbers/${form.dataset.profile}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: fd.get("name"),
        standingOrders: fd.get("standingOrders") ?? "",
        style: fd.get("style") || undefined,
      }),
    });
    editingId = null;
  } catch (err) {
    alert(err.message);
  }
});

$("btn-start").addEventListener("click", async () => {
  try {
    await api("/api/start", {
      method: "POST",
      body: JSON.stringify({ fairWeather: $("fair-weather").checked }),
    });
  } catch (err) {
    alert(err.message);
  }
});

document.querySelectorAll("input[name=ui-skin]").forEach((r) => {
  r.addEventListener("change", () => {
    if (r.checked) applyUi(r.value);
  });
});
try {
  applyUi(localStorage.getItem(UI_KEY) === "pixel63" ? "pixel63" : "field");
} catch (_) {
  applyUi("field");
}

$("btn-lobby").addEventListener("click", async () => {
  await api("/api/lobby", { method: "POST", body: "{}" });
});

function syncLlmForm() {
  const provider = $("llm-provider").value;
  const compat = provider === "openai-compat";
  $("llm-base").hidden = !compat;
  $("llm-base").required = compat;
  $("llm-model").value = compat ? "" : "grok-4.3";
  $("llm-base").placeholder = compat ? "https://api.openai.com/v1" : "";
}
$("llm-provider").addEventListener("change", syncLlmForm);

const heuristicName = $("form-heuristic").elements.namedItem("name");
heuristicName.addEventListener("input", () => {
  const key = String(heuristicName.value || "")
    .trim()
    .toLowerCase()
    .replaceAll("é", "e");
  if (key === "serac" || key === "cornice" || key === "scree") {
    $("heuristic-style").value = key;
  }
});

function connect() {
  const es = new EventSource("/api/events");
  es.onmessage = (ev) => {
    snap = JSON.parse(ev.data);
    render();
  };
}

async function poll() {
  try {
    snap = await api("/api/expedition");
    render();
  } catch {
    /* restarting */
  }
}

connect();
poll();
setInterval(renderCountdown, 250);
setInterval(poll, 2500);
