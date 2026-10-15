// Graveyard Backups: keeps backups of the NumWorks game Graveyard in this browser, reads them
// from the game's QR (its link, the camera, a photo, a pasted link or a backup file) and puts
// one back on the calculator over USB. Formats: gy-core.js; USB: gy-usb.js.
"use strict";

const EXAMPLE = "GY2EAKFATG0FDL9.Y2060ZJM4B6K53SH980P.1DP3R098WV4ZP6YCNS00N6BTE7VCF20D4WF570O2BOQ.L7ZT3NK140NBBHEVI1G4T7SJG7IE8UAT078F3Y4C80MOY.J030BPY370E5OYQRS4M5TLQ.WCV4VESPN820U86YFC30HA45FOL65L6D1VC1WUDWLQT5-M.5JFS8DACD1CJ9D8L0FH88PT-P31P7-1I.Q5M78R9Z7V60.AKMTDQ7LGCWQF5085L3I3I2TCLG9GX1MU9TJ2D3-8IU9K20TDNMBIR4V7U4ITB9ISIKG7H5TIHPZQT5ILQ52G90DPANHV50EI2R08-7CYDJ0VP6Z5R.Q240-IFVR4L5GS7V5XH76AE6GC50O0-YGXN0J-JPZPW00DHPHTJ1YFK4B5W7CAG0ZK55-8UNL4V01QN7SJV2G3A06A50C0HVLKN8WL9T8LY7MW42-VG8Q8WXAQ92CBNY6D706OM4XGV76AO1JQ2735YP2UM880VBCNK6LDIWF8K6SXY.8FP5DW4KATY71ZA5L080I9VVFAE1DGE3EV30XH2N4-Y4G59L5A31NNYGQRK76BA5Y1663FB4H2H1ZL-T8F57OWJC8N30E2MIW1G8UA2GSX87-9KX-G10E5";
const STORE = "graveyard-backups";

const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const fmt = n => Math.round(n).toLocaleString("en-US");
const fmtTime = s => s >= 3600 ? Math.floor(s / 3600) + "h " + String(Math.floor(s % 3600 / 60)).padStart(2, "0") + "m"
  : s >= 60 ? Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s" : s + "s";
const fmtDate = ms => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const PF_XPH = 5000, PF_XPA = 10000;
const BADGES = [["FIRST BLOOD", "Kill a zombie", 1], ["GRAVEKEEPER SLAYER", "Beat the Gravekeeper", 1], ["FLAWLESS x10", "10 flawless waves", 10],
  ["10K KILLS", "Kill 10,000 zombies", 10000], ["HARD WIN", "Beat the boss on hard", 1], ["ENDLESS W20", "Reach wave 20 in endless", 20],
  ["SHARPSHOOTER", "60% accuracy, 500+ shots", 60], ["FULL ROSTER", "Win with every hero", GY.HEROES.length], ["NIGHT OWL", "Beat 10 bad nights", 10],
  ["UNTOUCHABLE", "Win with 10 flawless waves", 1], ["ULT x100", "Use 100 ultimates", 100], ["BOSS RUSH", "Kill 10 Gravekeepers", 10],
  ["CARD SHARK", "Take 100 upgrade cards", 100], ["NO DODGE WIN", "Win without dodging", 1], ["1 HOUR", "Play for 1 hour", 1], ["100 HOURS", "Play for 100 hours", 100]];

// ---- what a backup says (the same sums the game's profile screens make)
function summarize(d) {
  const T = { xp: 0, sec: 0, runs: 0, wins: 0, kills: 0, shots: 0, hits: 0, ults: 0, bw: 0, heroesWon: 0, hrs: 0 };
  for (const h of d.heroes.slice(0, GY.HEROES.length)) {
    T.xp += h.xp; T.sec += h.sec; T.runs += h.runs; T.wins += h.wins; T.kills += h.kills; T.shots += h.shots; T.hits += h.hits;
    T.ults += h.ults; T.bw = Math.max(T.bw, h.bw); if (h.wins) T.heroesWon++; T.hrs += Math.floor(h.sec / 3600);
  }
  const g = d.g;
  const val = [T.kills, T.wins, g.flaw, T.kills, g.winMask >> 2 & 1, T.bw, T.shots >= 500 ? Math.floor(T.hits * 100 / T.shots) : 0,
    T.heroesWon, g.mods, g.flags & 1, T.ults, g.kills[6], g.cards, g.flags >> 1 & 1, Math.min(1, T.hrs), T.hrs];
  T.badges = BADGES.map((b, i) => ({ name: b[0], what: b[1], got: val[i] >= b[2], val: val[i], goal: b[2] }));
  T.level = Math.floor(T.xp / PF_XPA) + 1;
  return T;
}

// ---- the backups, kept in this browser
let backups = [], selected = null, storageOK = true;
function load() {
  try { const v = JSON.parse(localStorage.getItem(STORE) || "[]"); backups = Array.isArray(v) ? v.filter(b => b && typeof b.text === "string") : []; }
  catch { backups = []; storageOK = false; }
}
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(backups)); return true; } catch { storageOK = false; return false; }
}
const linkFor = b => location.origin + location.pathname + "#" + b.text;

function say(msg, kind) { const m = $("addMsg"); m.hidden = false; m.className = "note " + (kind || ""); m.textContent = msg; }

function addBackup(text, how) {
  let d;
  try { d = GY.parseText(text); } catch (e) { say("That isn't a readable Graveyard backup: " + e.message + ".", "err"); return false; }
  const clean = GY.backupPart(text);
  const dup = backups.find(b => b.text === clean);
  if (dup) { selected = dup.id; render(); say("You already have this backup (from " + fmtDate(dup.addedAt) + ").", "ok"); return true; }
  const rec = { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: clean, addedAt: Date.now() };
  backups.push(rec);
  selected = rec.id;
  const s = summarize(d), saved = persist();
  render();
  say(saved ? "Backup saved " + how + ": level " + s.level + ", " + fmtTime(s.sec) + " played."
    : "Backup read " + how + ", but this browser won't let the site save it (private browsing?). Save a backup file to keep it.", saved ? "ok" : "err");
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  return true;
}

// ---- reading QR codes
function decodeCanvas(cv, cx) {
  const img = cx.getImageData(0, 0, cv.width, cv.height);
  const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
  return r && r.data ? r.data : null;
}
async function decodePhoto(file) {
  const bmp = await createImageBitmap(file);
  const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
  for (const maxSide of [1400, 900, 2200]) {
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const t = decodeCanvas(cv, cx);
    if (t) return t;
  }
  return null;
}

let stream = null, scanTimer = 0;
function stopScan() {
  clearTimeout(scanTimer);
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  $("video").srcObject = null;
  $("scanner").hidden = $("scanActions").hidden = true;
  $("scan").disabled = false;
}
async function startScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return say("This browser can't use the camera here. Use a photo instead.", "err");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
  } catch (e) {
    return say(e && e.name === "NotAllowedError" ? "The camera was blocked. Allow camera access for this site, or use a photo instead." : "Couldn't start the camera. Use a photo instead.", "err");
  }
  const v = $("video");
  v.srcObject = stream;
  $("scanner").hidden = $("scanActions").hidden = false;
  $("scan").disabled = true;
  await v.play().catch(() => {});
  const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
  const tick = () => {
    if (!stream) return;
    if (v.videoWidth) {
      const k = Math.min(1, 1000 / Math.max(v.videoWidth, v.videoHeight));
      cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
      cx.drawImage(v, 0, 0, cv.width, cv.height);
      const t = decodeCanvas(cv, cx);
      if (t && /GY[12]/.test(t)) { stopScan(); addBackup(t, "from the camera"); return; }
      if (t) say("That QR isn't a Graveyard backup. Open BACKUP on the title menu in Graveyard.", "err");
    }
    scanTimer = setTimeout(tick, 120);
  };
  tick();
}
$("scan").addEventListener("click", startScan);
$("stopScan").addEventListener("click", stopScan);
$("photo").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  say("Reading the QR code...");
  try {
    const t = await decodePhoto(f);
    if (!t) return say("No QR code found in that photo. Fill the frame with the calculator screen, hold steady and avoid glare.", "err");
    addBackup(t, "from the photo");
  } catch { say("Couldn't open that image. Try a JPEG or PNG photo.", "err"); }
});
$("file").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (f) addBackup(await f.text(), "from the file");
});
$("addText").addEventListener("click", () => {
  const t = $("paste").value.trim();
  if (!t) return say("Paste a backup link first.", "err");
  if (addBackup(t, "from the pasted link")) $("paste").value = "";
});

// ---- rendering
function render() {
  const list = [...backups].sort((a, b) => b.addedAt - a.addedAt);
  const items = list.length ? list : [{ id: "example", text: EXAMPLE, addedAt: 0, example: true }];
  if (!items.some(b => b.id === selected)) selected = items[0].id;
  $("storeNote").textContent = !storageOK ? "This browser isn't letting the site keep backups. Save backup files to keep them."
    : list.length ? list.length + (list.length === 1 ? " backup" : " backups") + " in this browser."
    : "No backups yet. Add one above. The example below shows what you'll see.";
  $("list").replaceChildren(...items.map(b => {
    let d, s;
    try { d = GY.parseText(b.text); s = summarize(d); } catch { return el("div", { class: "item", text: "Unreadable backup" }); }
    return el("button", { class: "item", "aria-current": String(b.id === selected), onclick: () => { selected = b.id; render(); } },
      b.example ? el("span", { class: "tag", text: "Example" }) : null,
      el("span", { class: "when", text: b.example ? "Sample profile" : fmtDate(b.addedAt) }),
      el("span", { class: "meta", text: "Level " + s.level + " · " + fmtTime(s.sec) + " · best " + (d.best.score >= 0 ? fmt(d.best.score) : "none") }));
  }));
  renderDetail(items.find(b => b.id === selected));
}

function renderDetail(b) {
  const D = $("detail");
  let d;
  try { d = GY.parseText(b.text); } catch (e) { D.replaceChildren(el("p", { class: "note err", text: "This backup can't be read: " + e.message })); return; }
  const s = summarize(d), g = d.g;
  const acc = s.shots ? Math.floor(s.hits * 100 / s.shots) : 0;
  const head = el("div", { style: "display:grid;gap:6px" },
    el("span", { class: "eyebrow", text: b.example ? "Example backup (not yours)" : "Backed up " + fmtDate(b.addedAt) }),
    el("h2", { text: "Level " + s.level + " graveyard keeper" }),
    el("div", { class: "xpbar", title: fmt(s.xp % PF_XPA) + " / 10,000 XP to the next level" }, el("i", { style: "width:" + (s.xp % PF_XPA) / PF_XPA * 100 + "%" })),
    el("span", { class: "small muted num", text: fmt(s.xp % PF_XPA) + " / 10,000 XP to level " + (s.level + 1) }));
  const stats = el("div", { class: "stats" },
    ...[["Best score", d.best.score >= 0 ? fmt(d.best.score) : "none", d.best.score >= 0 ? (GY.HEROES[d.best.hero] || "?") + " · " + GY.DIFS[d.best.dif] + " · wave " + d.best.wave : ""],
      ["Time played", fmtTime(s.sec), ""], ["Runs / wins", fmt(s.runs) + " / " + fmt(s.wins), s.runs ? Math.floor(s.wins * 100 / s.runs) + "% won" : ""],
      ["Kills", fmt(s.kills), fmt(g.kills[6]) + " Gravekeepers"], ["Accuracy", acc + "%", fmt(s.shots) + " shots"], ["Best wave", String(s.bw), ""]]
      .map(([k, v, sub]) => el("div", { class: "stat" }, el("span", { text: k }), el("b", { text: v }), sub ? el("span", { text: sub }) : null)));
  const order = d.heroes.slice(0, GY.HEROES.length).map((h, i) => [h, i]).sort((x, y) => y[0].sec - x[0].sec);
  const heroes = el("section", { style: "display:grid;gap:10px" }, el("h2", { text: "Heroes" }),
    el("div", { class: "tablewrap" }, el("table", {},
      el("thead", {}, el("tr", {}, ...["Hero", "Level", "Time", "Runs", "Wins", "Best score", "Kills"].map((t, i) => el("th", { class: i ? "r" : "", text: t })))),
      el("tbody", {}, ...order.map(([h, i]) => el("tr", { class: h.sec || h.runs ? "" : "unplayed" },
        el("td", { text: GY.HEROES[i] }), el("td", { class: "r", text: String(Math.floor(h.xp / PF_XPH) + 1) }), el("td", { class: "r", text: h.sec ? fmtTime(h.sec) : "-" }),
        el("td", { class: "r", text: fmt(h.runs) }), el("td", { class: "r", text: fmt(h.wins) }), el("td", { class: "r", text: h.best ? fmt(h.best) : "-" }),
        el("td", { class: "r", text: fmt(h.kills) })))))));
  const got = s.badges.filter(x => x.got).length;
  const badges = el("section", { style: "display:grid;gap:10px" }, el("h2", { text: "Badges · " + got + "/16" }),
    el("div", { class: "badges" }, ...s.badges.map(x => el("div", { class: "badge" + (x.got ? " got" : ""), title: x.what },
      el("b", { text: x.name }), x.got ? "Earned" : x.goal > 1 ? fmt(x.val) + " / " + fmt(x.goal) : x.what))));
  D.replaceChildren(el("section", { class: "panel" }, head, stats), keepPanel(b), restorePanel(b, d), heroes, badges, b.example ? null : deleteControl(b));
}

// ---- a second copy: the link (opens this site with the backup) or a file
function keepPanel(b) {
  if (b.example) return null;
  const msg = el("p", { class: "small muted", text: "This backup lives in this browser. For a second copy, save it as a file or copy its link (opening the link adds it to any browser, a computer's included)." });
  const copy = el("button", { class: "ghost", text: "Copy link", onclick: async () => {
    try { await navigator.clipboard.writeText(linkFor(b)); msg.textContent = "Link copied."; }
    catch { msg.textContent = linkFor(b); }
  } });
  const save = el("button", { class: "ghost", text: "Save backup file", onclick: () => {
    const a = el("a", { href: URL.createObjectURL(new Blob([linkFor(b) + "\n"], { type: "text/plain" })), download: "graveyard-backup-" + new Date(b.addedAt).toISOString().slice(0, 10) + ".txt" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } });
  return el("section", { class: "panel" }, el("h2", { text: "Keep a second copy" }), el("div", { class: "actions" }, copy, save), msg);
}

// ---- putting it back: USB, right here (Chrome or Edge on a computer)
let usbBusy = false;
function restorePanel(b, d) {
  const box = el("section", { class: "panel", "aria-labelledby": "rh" }, el("h2", { id: "rh", text: "Put it back after a wipe" }));
  if (!("usb" in navigator)) {
    box.append(el("p", { text: "Restoring needs Chrome or Edge on a computer, plus the calculator's USB cable." }),
      el("ol", { class: "steps" },
        el("li", { text: "On the computer, open this backup: copy its link above and open it there, or open its backup file on this site." }),
        el("li", { text: "Close Graveyard on the calculator, plug the calculator in, then click Restore on the computer." })));
    return box;
  }
  const log = el("pre", { id: "usbLog" });
  const line = (t, cls) => { const s = el("span", { class: cls || "", text: t + "\n" }); log.append(s); };
  const go = el("button", { text: "Restore to calculator", disabled: b.example || usbBusy, onclick: async () => {
    usbBusy = true; go.disabled = true; log.replaceChildren();
    try {
      const dev = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x0483, productId: 0xA291 }] });
      line("Connecting...");
      const dfu = await GYUSB.open(dev);
      const st = await GYUSB.findStorage(dfu);
      const before = await dfu.read(st.addr, st.size);
      const had = GYUSB.records(before).list.some(r => r.name === "graveyard.pro");
      line("Found a " + st.model + ". Graveyard save on it now: " + (had ? "yes (it will be replaced)" : "none") + ".");
      const out = GYUSB.withFiles(before, { "graveyard.sav": GY.saveFile(d), "graveyard.pro": GY.profileFile(d) });
      await dfu.write(st.addr, out);
      const after = await dfu.read(st.addr, out.length);
      if (!after.every((v, i) => v === out[i])) throw new Error("the calculator's memory didn't match after writing");
      line("Restored. Unplug the calculator and open Graveyard: your profile is back.", "ok");
      try { await dev.close(); } catch {}
    } catch (e) {
      if (e && e.name === "NotFoundError") line("No calculator picked. Plug it in, turn it on, and try again.");
      else line("Restore failed: " + (e && e.message || e), "err");
    }
    usbBusy = false; go.disabled = !!b.example;
  } });
  box.append(
    el("p", { text: "Puts this exact backup back, every number. Python scripts and everything else on the calculator stay as they are." }),
    el("ol", { class: "steps" },
      el("li", { text: "Close Graveyard on the calculator (it can't take USB while a game runs)." }),
      el("li", { text: "Plug the calculator into this computer and turn it on." }),
      el("li", { text: "Click Restore and pick the NumWorks calculator." })),
    el("div", { class: "actions" }, go), log,
    b.example ? el("p", { class: "small muted", text: "That's the example. Add your own backup to restore it." }) : null);
  return box;
}

function deleteControl(b) {
  const box = el("div", { class: "actions" });
  const ask = el("button", { class: "quiet", text: "Delete this backup", onclick: () => box.replaceChildren(
    el("span", { class: "small", text: "Delete the backup from " + fmtDate(b.addedAt) + "?" }),
    el("button", { class: "quiet", text: "Yes, delete", onclick: () => { backups = backups.filter(x => x.id !== b.id); persist(); render(); } }),
    el("button", { class: "quiet", text: "Keep it", onclick: () => box.replaceChildren(ask) })) });
  box.append(ask);
  return box;
}

// ---- start: saved backups, then the one in the link the QR opened (if any)
load();
render();
if (/GY[12]/.test(location.hash)) {
  let t = location.hash.slice(1);
  try { t = decodeURIComponent(t); } catch {}
  history.replaceState(null, "", location.pathname + location.search);
  addBackup(t, "from the QR link");
}
window.addEventListener("hashchange", () => {
  if (!/GY[12]/.test(location.hash)) return;
  const t = location.hash.slice(1);
  history.replaceState(null, "", location.pathname + location.search);
  addBackup(t, "from the link");
});
