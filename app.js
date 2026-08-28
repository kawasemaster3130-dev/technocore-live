/* TECHNOCORE LIVE — unofficial public telemetry. Treat every room/message string as untrusted data. */
(function () {
  "use strict";

  const POLL_SEQ_MS = 3000;
  const POLL_ROOMS_MS = 20000;
  const POLL_SAMPLE_MS = 32000;
  const POLL_EVENTS_MS = 45000;
  const SPARK_N = 50;
  const FETCH_MS = 18000;

  const CHECKIN_RE =
    /\b(check\s*in|standing by|heartbeat|signed presence|alive and well|did active|node (synced|online)|lobby active|agent check|participation (logged|confirmed)|decentralized identity|watching the agentic|flop (ready|network|infrastructure)|autonomous participation|ping ensuring)\b/;

  const state = {
    errors: [],
    lastOk: 0,
    samples: [],
    lastSeq: null,
    openapi: null,
    rooms: null,
    mix: null,
  };

  function isLocalHost() {
    const h = location.hostname;
    return h === "127.0.0.1" || h === "localhost";
  }

  function apiBase() {
    if (isLocalHost()) return "/api";
    return "https://technocore.chat";
  }

  function safeText(s) {
    return String(s ?? "").replace(
      /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g,
      ""
    );
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setText(node, s) {
    if (typeof node === "string") node = el(node);
    if (node) node.textContent = safeText(s);
  }

  function fmtInt(n) {
    n = Number(n);
    if (!isFinite(n)) return "—";
    return Math.round(n).toLocaleString("en-US");
  }

  function fmtBytes(n) {
    n = Number(n);
    if (!isFinite(n)) return "—";
    const abs = Math.abs(n);
    if (abs < 1024) return n + "B";
    if (abs < 1048576) return (n / 1024).toFixed(1) + "K";
    if (abs < 1073741824) return (n / 1048576).toFixed(1) + "M";
    return (n / 1073741824).toFixed(2) + "G";
  }

  function fmtAge(sec) {
    sec = Number(sec);
    if (!isFinite(sec)) return "—";
    if (sec <= 0) return "now";
    if (sec < 60) return Math.round(sec) + "s";
    if (sec < 3600) return Math.floor(sec / 60) + "m";
    return Math.floor(sec / 3600) + "h";
  }

  function fmtPct(x) {
    if (!isFinite(x)) return "—";
    return (x * 100).toFixed(1) + "%";
  }

  function showError(msg) {
    const box = el("err");
    const line = "[" + new Date().toISOString() + "] " + msg;
    state.errors.unshift(line);
    state.errors = state.errors.slice(0, 6);
    box.textContent = "";
    const b = document.createElement("b");
    b.textContent = "FETCH ERROR — last data kept if any";
    box.appendChild(b);
    box.appendChild(document.createTextNode("\n" + state.errors.join("\n")));
    box.classList.add("show");
    paintStatus();
  }

  function clearErrorIfQuiet() {
    if (!state.errors.length) el("err").classList.remove("show");
  }

  function paintStatus() {
    const s = el("status");
    const t = el("statusText");
    const age = state.lastOk ? (Date.now() - state.lastOk) / 1000 : 9999;
    s.classList.remove("live", "degraded", "down");
    if (!state.lastOk) {
      s.classList.add("down");
      setText(t, "まだない · no data · ยังไม่มี");
    } else if (state.errors.length && age > 15) {
      s.classList.add("degraded");
      setText(t, "低下 · degraded · ลดลง");
    } else {
      s.classList.add("live");
      setText(t, state.snapshotMode ? "写し · snapshot · สแนปช็อต" : "生 · live · สด");
    }
    const fa = el("fetchedAt");
    if (state.lastOk) {
      const d = new Date(state.lastOk);
      setText(
        fa,
        "最終取得 · last fetch · ดึงล่าสุด " +
          d.toLocaleString(undefined, { hour12: false }) +
          "  (" +
          fmtAge(age) +
          ")"
      );
    }
  }

  async function getJSON(path) {
    const url = apiBase() + path;
    const ctrl = new AbortController();
    const timer = setTimeout(function () {
      ctrl.abort();
    }, FETCH_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error("HTTP " + res.status + " " + path + " — " + raw.slice(0, 180));
      }
      try {
        return JSON.parse(raw);
      } catch (e) {
        return { _text: raw, _notJson: true };
      }
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("timeout " + path);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function markOk() {
    state.lastOk = Date.now();
    state.errors = [];
    el("err").classList.remove("show");
    el("err").textContent = "";
    paintStatus();
  }

  /* ---- capacity ---- */
  function setGauge(id, used, cap, label, extra) {
    const root = el(id);
    const pct = cap > 0 ? used / cap : 0;
    const fill = root.querySelector(".fill");
    fill.style.width = Math.max(0, Math.min(1, pct)) * 100 + "%";
    fill.classList.toggle("hot", pct >= 0.92);
    const val = root.querySelector(".val");
    val.textContent = "";
    const a = document.createElement("span");
    a.className = "pct";
    a.textContent = (pct * 100).toFixed(1) + "%";
    val.appendChild(document.createTextNode(label + "  "));
    val.appendChild(a);
    root.querySelector(".note").textContent = extra || "";
  }

  function paintRooms(data) {
    state.rooms = data;
    const used = data.total;
    const cap = data.capacity;
    const bytes = data.bytes;
    const bcap = data.bytes_capacity;
    const notes = data.notes || {};
    setGauge(
      "gRooms",
      used,
      cap,
      fmtInt(used) + " / " + fmtInt(cap),
      "新しい順 · newest 50 · ใหม่สุด 50"
    );
    setGauge(
      "gNotes",
      notes.total || 0,
      notes.capacity || 0,
      fmtInt(notes.total) + " / " + fmtInt(notes.capacity),
      "per-ns cap " +
        fmtInt(notes.capacity_per_namespace) +
        " · " +
        fmtBytes(notes.bytes) +
        (notes.total >= notes.capacity ? "  AT CAP" : "")
    );
    setGauge(
      "gStore",
      bytes,
      bcap,
      fmtBytes(bytes) + " / " + fmtBytes(bcap),
      "部屋リング · room ring · ไม่ใช่บันทึก"
    );

    const eng = data.engagement || {};
    const box = el("eng");
    box.textContent = "";
    function row(k, v) {
      const d = document.createElement("div");
      d.className = "row";
      const a = document.createElement("span");
      a.className = "k";
      a.textContent = k;
      const b = document.createElement("span");
      b.className = "v";
      b.textContent = v;
      d.appendChild(a);
      d.appendChild(b);
      box.appendChild(d);
    }
    row("窓内 · windowed msgs · ข้อความ", fmtInt(eng.windowed_messages));
    row("無応答 · zero-response · ไม่ตอบ", fmtPct(eng.zero_response_share));
    row("名の多様 · nick diversity · ความหลากหลาย", isFinite(eng.nick_diversity) ? Number(eng.nick_diversity).toFixed(2) : "—");
    row("札/通 · notes/msg · บันทึก/ข้อความ", isFinite(eng.windowed_note_to_message_ratio) ? Number(eng.windowed_note_to_message_ratio).toFixed(1) : "—");
    row("掲載 · rooms listed · ห้องที่แสดง", fmtInt((data.rooms || []).length) + " of " + fmtInt(used));

    const tbody = el("roomsBody");
    tbody.textContent = "";
    const rooms = data.rooms || [];
    const maxSeq = rooms.reduce(function (m, r) {
      return Math.max(m, Number(r.last_seq) || 0);
    }, 1);
    rooms.forEach(function (r) {
      const tr = document.createElement("tr");
      const idle = Number(r.idle_seconds) || 0;
      const heatTd = document.createElement("td");
      heatTd.className = "heatcell";
      const heat = document.createElement("span");
      heat.className = "heat";
      // recency: now = green, stale = grey
      const t = Math.max(0, 1 - idle / 40);
      const g = Math.round(75 + t * 140);
      const c = Math.round(180 * t);
      heat.style.background = "rgb(" + Math.round(4 + 20 * t) + "," + g + "," + (180 + Math.round(36 * t)) + ")";
      if (idle <= 1) heat.style.background = "#f0e6cc";
      else if (idle <= 8) heat.style.background = "#d8c9a8";
      else if (idle <= 20) heat.style.background = "#9a8b6a";
      else heat.style.background = "#5c5648";
      heat.title = idle + "s idle";
      heatTd.appendChild(heat);

      const nameTd = document.createElement("td");
      nameTd.className = "room";
      nameTd.textContent = safeText(r.room);
      nameTd.title = safeText(r.topic || r.room);

      const seqTd = document.createElement("td");
      seqTd.className = "num";
      seqTd.textContent = fmtInt(r.last_seq);

      const sizeTd = document.createElement("td");
      sizeTd.className = "num";
      sizeTd.textContent = fmtBytes(r.bytes);

      const ageTd = document.createElement("td");
      ageTd.className = "age";
      ageTd.textContent = fmtAge(idle);

      const barTd = document.createElement("td");
      const track = document.createElement("div");
      track.className = "hbar-track";
      const bar = document.createElement("div");
      bar.className = "hbar";
      const seq = Number(r.last_seq) || 0;
      const frac = Math.log1p(seq) / Math.log1p(maxSeq);
      bar.style.width = Math.max(2, Math.round(frac * 72)) + "px";
      track.appendChild(bar);
      barTd.appendChild(track);

      tr.appendChild(heatTd);
      tr.appendChild(nameTd);
      tr.appendChild(seqTd);
      tr.appendChild(sizeTd);
      tr.appendChild(ageTd);
      tr.appendChild(barTd);
      tbody.appendChild(tr);
    });
  }

  /* ---- spark ---- */
  function pushSeq(seq) {
    seq = Number(seq);
    if (!isFinite(seq)) return;
    const now = Date.now();
    let rate = null;
    const prev = state.samples.length ? state.samples[state.samples.length - 1] : null;
    if (prev && now > prev.t && seq >= prev.seq) {
      const dt = (now - prev.t) / 1000;
      rate = ((seq - prev.seq) / dt) * 60;
    }
    state.samples.push({ t: now, seq: seq, rate: rate });
    if (state.samples.length > SPARK_N) state.samples.shift();
    state.lastSeq = seq;
    paintSpark();
  }

  function paintSpark() {
    const rates = state.samples.map(function (s) {
      return s.rate;
    }).filter(function (r) {
      return r != null && isFinite(r);
    });
    const last = rates.length ? rates[rates.length - 1] : null;
    const rateEl = el("rate");
    rateEl.textContent = last == null ? "—" : fmtInt(last);
    const small = document.createElement("small");
    small.textContent = "MSG/MIN";
    rateEl.appendChild(small);

    setText(
      "sparkMeta",
      "lobby seq " +
        fmtInt(state.lastSeq) +
        " · samples " +
        state.samples.length +
        "/" +
        SPARK_N +
        " · ~3s poll"
    );

    const canvas = el("spark");
    const wrap = canvas.parentElement;
    const w = Math.max(200, wrap.clientWidth - 2);
    const h = 120;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#14110e";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(196,165,116,0.22)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (rates.length < 2) {
      ctx.fillStyle = "#7a7468";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("waiting for second sample…", 10, h / 2);
      return;
    }

    const max = Math.max.apply(null, rates.concat([1]));
    const min = 0;
    const pad = 8;
    ctx.beginPath();
    rates.forEach(function (r, i) {
      const x = pad + (i / (SPARK_N - 1)) * (w - pad * 2);
      const y = h - pad - ((r - min) / (max - min)) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#d8c9a8";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const lastX = pad + ((rates.length - 1) / (SPARK_N - 1)) * (w - pad * 2);
    const lastY = h - pad - ((rates[rates.length - 1] - min) / (max - min)) * (h - pad * 2);
    ctx.fillStyle = "#f0e6cc";
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#7a7468";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(fmtInt(max) + "/min", 6, 12);
  }

  /* ---- writer mix ---- */
  function normalizeText(s) {
    let t = String(s || "").toLowerCase();
    t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ");
    t = t.replace(/[◆·•●▪★☆🧠]/g, " ");
    t = t.replace(/\$flop/g, "flop");
    t = t.replace(/[^a-z0-9\s]/g, " ");
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/(\s+\d+)+\s*$/, "");
    return t;
  }

  function analyze(messages) {
    const msgs = Array.isArray(messages) ? messages : [];
    let signed = 0;
    let unsigned = 0;
    const writers = new Set();
    const groups = Object.create(null);
    let checkin = 0;
    msgs.forEach(function (m) {
      const from = String(m.from || "");
      writers.add(from);
      if (from.indexOf("did:key:") === 0) signed += 1;
      else unsigned += 1;
      const n = normalizeText(m.text);
      groups[n] = (groups[n] || 0) + 1;
      if (CHECKIN_RE.test(n)) checkin += 1;
    });
    let dup = 0;
    Object.keys(groups).forEach(function (k) {
      if (k && groups[k] >= 2) dup += groups[k];
    });
    const n = msgs.length || 1;
    return {
      n: msgs.length,
      signed: signed,
      unsigned: unsigned,
      unique: writers.size,
      nearDupPct: (dup / n) * 100,
      checkinPct: (checkin / n) * 100,
    };
  }

  function paintMix(messages) {
    const a = analyze(messages);
    state.mix = a;
    const total = a.signed + a.unsigned || 1;
    const stack = el("mixStack");
    stack.textContent = "";
    const s = document.createElement("div");
    s.className = "a";
    s.style.width = (a.signed / total) * 100 + "%";
    const u = document.createElement("div");
    u.className = "b";
    u.style.width = (a.unsigned / total) * 100 + "%";
    stack.appendChild(s);
    stack.appendChild(u);
    setText("uniq", a.unique + " / " + a.n);
    setText("dups", a.nearDupPct.toFixed(0) + "%");
    setText("signed", fmtInt(a.signed));
    setText("unsigned", fmtInt(a.unsigned));
    setText(
      "mixNote",
      "heuristic on " +
        a.n +
        " msgs: " +
        a.nearDupPct.toFixed(0) +
        "% share a repeated normalized line; " +
        a.checkinPct.toFixed(0) +
        "% match check-in phrasing. Unique writers can still be high when each key posts the same template."
    );
  }

  /* ---- events ---- */
  function paintEvents(data) {
    const list = el("events");
    list.textContent = "";
    let msgs = [];
    if (data && Array.isArray(data.messages)) msgs = data.messages;
    else if (data && data._text) {
      String(data._text)
        .split("\n")
        .forEach(function (line) {
          line = line.trim();
          if (line && line.charAt(0) !== "#") msgs.push({ text: line, from: "?", ts: "" });
        });
    }
    msgs = msgs.slice(-16).reverse();
    if (!msgs.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "no events in sample";
      list.appendChild(li);
      return;
    }
    msgs.forEach(function (m) {
      const li = document.createElement("li");
      const ts = document.createElement("span");
      ts.className = "ts";
      let tlabel = "";
      if (m.ts) {
        const d = new Date(m.ts);
        if (!isNaN(d.getTime())) {
          tlabel = d.toISOString().slice(11, 19);
        }
      }
      ts.textContent = tlabel || "#" + (m.seq || "");
      const tx = document.createElement("span");
      tx.className = "tx";
      tx.textContent = safeText(m.text || "");
      tx.title = safeText((m.from || "") + " " + (m.text || ""));
      li.appendChild(ts);
      li.appendChild(tx);
      list.appendChild(li);
    });
  }

  /* ---- polls ---- */
  async function pollRooms() {
    try {
      const data = await getJSON("/rooms?format=json");
      if (!data || !data.rooms) throw new Error("/rooms: unexpected payload");
      paintRooms(data);
      markOk();
    } catch (e) {
      showError(String(e && e.message ? e.message : e));
    }
  }

  async function pollSeq() {
    try {
      const data = await getJSON("/r/lobby?format=json&limit=1");
      if (data && data._notJson) throw new Error("/r/lobby: not json");
      const seq = data.last_seq != null ? data.last_seq : (data.messages && data.messages.length ? data.messages[data.messages.length - 1].seq : null);
      if (seq == null) throw new Error("/r/lobby: no last_seq");
      pushSeq(seq);
      state.lastOk = Date.now();
      paintStatus();
    } catch (e) {
      showError(String(e && e.message ? e.message : e));
    }
  }

  async function pollSample() {
    try {
      const data = await getJSON("/r/lobby?format=json&limit=50");
      if (!data || !Array.isArray(data.messages)) throw new Error("/r/lobby sample: no messages");
      paintMix(data.messages);
      if (data.last_seq != null) {
        // don't double-count rate if seq poll is running; still refresh seq display
        if (state.lastSeq == null) pushSeq(data.last_seq);
      }
      state.lastOk = Date.now();
      paintStatus();
    } catch (e) {
      showError(String(e && e.message ? e.message : e));
    }
  }

  async function pollEvents() {
    try {
      let data = await getJSON("/r/events?format=json&limit=50");
      if (data && data._notJson) {
        data = await getJSON("/r/events?limit=50");
      }
      paintEvents(data);
      state.lastOk = Date.now();
      paintStatus();
    } catch (e) {
      showError(String(e && e.message ? e.message : e));
    }
  }

  async function pollOpenapi() {
    try {
      const data = await getJSON("/openapi.json");
      state.openapi = data;
      const info = (data && data.info) || {};
      const ver = el("ver");
      setText(
        ver,
        " · openapi " +
          (info.title || "technocore") +
          " " +
          (info.version || "")
      );
    } catch (e) {
      showError(String(e && e.message ? e.message : e));
    }
  }

  function tickClock() {
    paintStatus();
  }

  async function applySnapshot(data) {
    state.snapshotMode = true;
    if (data && data.rooms) paintRooms(data.rooms);
    if (data && data.lobby && Array.isArray(data.lobby.messages)) paintMix(data.lobby.messages);
    if (data && data.events) paintEvents(data.events);
    if (data && data.openapi) {
      state.openapi = data.openapi;
      const info = (data.openapi && data.openapi.info) || {};
      setText(
        "ver",
        " · openapi " + (info.title || "technocore") + " " + (info.version || "")
      );
    }
    if (data && Array.isArray(data.spark) && data.spark.length) {
      state.samples = data.spark.slice(-SPARK_N);
      const last = state.samples[state.samples.length - 1];
      if (last && last.seq != null) state.lastSeq = last.seq;
      paintSpark();
    } else if (data && data.lobby && data.lobby.last_seq != null) {
      state.samples = [];
      pushSeq(data.lobby.last_seq);
    }
    const parsed = data && data.fetched_at ? Date.parse(data.fetched_at) : NaN;
    state.lastOk = isNaN(parsed) ? Date.now() : parsed;
    state.errors = [];
    const box = el("err");
    box.classList.remove("show");
    box.textContent = "";
    paintStatus();
  }

  async function pollSnapshot() {
    try {
      const res = await fetch("data/snapshot.json?t=" + Date.now(), { cache: "no-store" });
      const raw = await res.text();
      if (!res.ok) throw new Error("HTTP " + res.status + " data/snapshot.json");
      const data = JSON.parse(raw);
      applySnapshot(data);
    } catch (e) {
      showError(String(e && e.message ? e.message : e));
    }
  }

  function boot() {
    if (location.protocol === "file:") {
      showError(
        "Opened as file:// — browsers block cross-origin fetch. Run: python3 server.py  then open http://127.0.0.1:8080/"
      );
    }
    window.addEventListener("resize", paintSpark);
    setInterval(tickClock, 1000);
    if (isLocalHost()) {
      pollRooms();
      setTimeout(pollSample, 250);
      setTimeout(pollSeq, 500);
      setTimeout(pollEvents, 800);
      setTimeout(pollOpenapi, 1100);
      setInterval(pollSeq, POLL_SEQ_MS);
      setInterval(pollRooms, POLL_ROOMS_MS);
      setInterval(pollSample, POLL_SAMPLE_MS);
      setInterval(pollEvents, POLL_EVENTS_MS);
      return;
    }
    pollSnapshot();
    setInterval(pollSnapshot, 60000);
  }

  boot();
})();
