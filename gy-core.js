// Graveyard backup formats, mirrored from graveyard.c (BACKUP QR, SAVE FILE, PROFILE).
// Change both together.
const GY = (() => {
  const HEROES = ["SOLDIER", "BRUTE", "GUNNER", "SNIPER", "GRAVEDIGGER", "CARETAKER", "RAT KING",
    "CLOCKMAKER", "GAMBLER", "UNDERTAKER", "STOKER"];
  const KINDS = ["WALKER", "RUNNER", "SPITTER", "HULK", "SCREAMER", "GRABBER", "GRAVEKEEPER"];
  const DIFS = ["EASY", "NORMAL", "HARD"];
  const HERO_FIELDS = ["sec", "best", "kills", "dmg", "taken", "shots", "hits", "xp", "wsum",
    "runs", "wins", "big", "abil", "ults", "dodge", "bw"];
  // SAVE_LEN: version 2 of graveyard.sav (96 bytes: progression at 32-79); version 1 was 40
  const PF_MAXH = 16, PF_LEN = 4 + PF_MAXH * 49 + 65 + 4, SAVE_LEN = 96;
  const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

  function hash(x) {
    x = x >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x45D9F3B) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x45D9F3B) >>> 0;
    x ^= x >>> 16;
    return x >>> 0;
  }

  // ---- QR text -> backup
  function b45decode(s) {
    const out = [];
    for (let i = 0; i < s.length; i += 3) {
      const c = [...s.slice(i, i + 3)].map(ch => B45.indexOf(ch));
      if (c.some(v => v < 0)) throw new Error("not a Graveyard backup (bad character)");
      if (c.length === 3) {
        const n = c[0] + c[1] * 45 + c[2] * 2025;
        if (n > 65535) throw new Error("not a Graveyard backup (bad group)");
        out.push(n >> 8, n & 255);
      } else if (c.length === 2) {
        const n = c[0] + c[1] * 45;
        if (n > 255) throw new Error("not a Graveyard backup (bad end)");
        out.push(n);
      } else throw new Error("backup text is cut short");
    }
    return Uint8Array.from(out);
  }

  function parseBytes(b, ver = 2) {   // ver 3 (GY3) adds progression at the end
    if (b.length < 8) throw new Error("backup is too short");
    let h = 0x6B5C0DE;
    for (let i = 0; i < b.length - 4; i++) h = hash(h ^ b[i]);
    const want = (b[b.length - 4] | b[b.length - 3] << 8 | b[b.length - 2] << 16 | b[b.length - 1] << 24) >>> 0;
    if (h !== want) throw new Error("backup check failed (a misread or an edited code)");
    let p = 0;
    const end = b.length - 4;
    const V = () => {
      let v = 0, sh = 0;
      for (;;) {
        if (p >= end) throw new Error("backup ends early");
        const c = b[p++];
        v += (c & 127) * 2 ** sh;
        if (c < 128) return v;
        sh += 7;
        if (sh > 35) throw new Error("backup number too long");
      }
    };
    const d = { nh: V() };
    if (d.nh < 1 || d.nh > PF_MAXH) throw new Error("backup has a strange hero count");
    const bs = V() - 1;
    d.best = { score: bs, hero: V(), dif: V(), wave: V() };
    d.hero = V(); d.dif = V(); d.toggles = V();
    d.heroes = [];
    for (let i = 0; i < d.nh; i++) {
      const o = {};
      for (const f of HERO_FIELDS) o[f] = V();
      d.heroes.push(o);
    }
    const g = { kills: [] };
    for (let k = 0; k < 7; k++) g.kills.push(V());
    g.flaw = V(); g.mods = V(); g.cards = V(); g.longest = V(); g.mostKills = V();
    g.bestDif = [V(), V(), V()];
    g.winMask = V(); g.longestHero = V(); g.mostKillsHero = V(); g.flags = V();
    d.g = g;
    d.asc = 0; d.prog = [];                            // progression: ascension level chosen; per hero open level, alternates
    if (ver >= 3) {
      d.asc = V();
      for (let i = 0; i < d.nh; i++) d.prog.push({ ascMax: V(), altOpen: V(), altSel: V() });
    }
    if (p !== end) throw new Error("backup has extra data");
    return d;
  }

  // GY3 (the link the game shows now; GY2 before progression was added): base38, 8 characters per 5 bytes,
  // little-endian digits
  const B38 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.-";
  function b38decode(t) {
    const tailBytes = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4 };
    if (!(t.length % 8 in tailBytes)) throw new Error("backup text is cut short");
    const out = [];
    for (let i = 0; i < t.length; i += 8) {
      const chunk = t.slice(i, i + 8), k = chunk.length === 8 ? 5 : tailBytes[chunk.length];
      let v = 0;
      for (let j = chunk.length - 1; j >= 0; j--) v = v * 38 + B38.indexOf(chunk[j]);
      if (v >= 256 ** k) throw new Error("not a Graveyard backup (bad group)");
      for (let j = k - 1; j >= 0; j--) out.push(Math.floor(v / 256 ** j) % 256);
    }
    return Uint8Array.from(out);
  }

  // a backup from anything that holds one: the link, the part after '#', or older GY1 text
  function parseText(text) {
    let t = String(text).replace(/[\r\n]+/g, "");
    for (const ver of [3, 2]) {
      const i2 = t.indexOf("GY" + ver);
      if (i2 >= 0) {
        const m = t.slice(i2 + 3).match(/^[0-9A-Z.\-]*/)[0];
        return parseBytes(b38decode(m), ver);
      }
    }
    const i = t.indexOf("GY1");
    if (i < 0) throw new Error("not a Graveyard backup (no GY3, GY2 or GY1 in it)");
    t = t.slice(i + 3);
    // a pasted copy may have lost trailing spaces (space is a base45 digit): try them back
    let lastErr;
    for (let pad = 0; pad < 3; pad++) {
      try { return parseBytes(b45decode(t + " ".repeat(pad))); } catch (e) { lastErr = lastErr || e; }
    }
    throw lastErr;
  }

  // the backup part of a text, as stored (the link prefix dropped)
  function backupPart(text) {
    const t = String(text).replace(/[\r\n]+/g, "");
    for (const ver of [3, 2]) {
      const i2 = t.indexOf("GY" + ver);
      if (i2 >= 0) return "GY" + ver + t.slice(i2 + 3).match(/^[0-9A-Z.\-]*/)[0];
    }
    const i = t.indexOf("GY1");
    return i >= 0 ? "GY1" + t.slice(i + 3) : t;
  }

  // ---- the calculator's own files, byte for byte
  function put32(b, o, v) { v = v >>> 0; b[o] = v & 255; b[o + 1] = v >>> 8 & 255; b[o + 2] = v >>> 16 & 255; b[o + 3] = v >>> 24; }
  const cap32 = v => Math.min(v, 2000000000), cap16 = v => Math.min(v, 65535), cap8 = v => Math.min(v, 255);

  function saveFile(d) {
    const b = new Uint8Array(SAVE_LEN);
    b[0] = 71; b[1] = 89; b[2] = 2;
    put32(b, 4, d.best.score < 0 ? 0xFFFFFFFF : d.best.score);
    b[8] = d.best.hero; b[9] = d.best.dif; b[10] = cap8(d.best.wave);
    b[11] = d.hero; b[12] = d.dif; b[13] = d.toggles & 15;
    b[25] = cap8(d.asc || 0);                          // progression (zeros for a GY2 or GY1 backup)
    (d.prog || []).forEach((q, i) => {
      if (i < 16) { b[32 + 3 * i] = cap8(q.ascMax); b[33 + 3 * i] = cap8(q.altOpen); b[34 + 3 * i] = cap8(q.altSel); }
    });
    let h = 0x6EA7E5;
    for (let i = 0; i < SAVE_LEN - 4; i++) h = hash(h ^ b[i]);
    put32(b, SAVE_LEN - 4, h);
    return b;
  }

  function profileFile(d) {
    const b = new Uint8Array(PF_LEN);
    b[0] = 71; b[1] = 80; b[2] = 1;
    let c = 4;
    const w32 = v => { put32(b, c, cap32(v)); c += 4; };
    const w16 = v => { v = cap16(v); b[c] = v & 255; b[c + 1] = v >> 8; c += 2; };
    const w8 = v => { b[c++] = cap8(v); };
    for (let i = 0; i < PF_MAXH; i++) {
      const p = d.heroes[i] || {};
      for (const f of ["sec", "best", "kills", "dmg", "taken", "shots", "hits", "xp", "wsum"]) w32(p[f] || 0);
      for (const f of ["runs", "wins", "big", "abil", "ults", "dodge"]) w16(p[f] || 0);
      w8(p.bw || 0);
    }
    const g = d.g;
    for (let k = 0; k < 7; k++) w32(g.kills[k]);
    w32(g.flaw); w32(g.mods); w32(g.cards); w32(g.longest); w32(g.mostKills);
    for (let k = 0; k < 3; k++) w32(g.bestDif[k]);
    w8(g.winMask); w8(g.longestHero); w8(g.mostKillsHero); w16(g.flags);
    let h = 0x9F0F11;
    for (let i = 0; i < PF_LEN - 4; i++) h = hash(h ^ b[i]);
    put32(b, PF_LEN - 4, h);
    return b;
  }

  return { HEROES, KINDS, DIFS, HERO_FIELDS, PF_LEN, SAVE_LEN, hash, parseText, parseBytes, backupPart, saveFile, profileFile };
})();
if (typeof module !== "undefined") module.exports = GY;
