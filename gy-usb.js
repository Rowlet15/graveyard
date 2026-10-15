// Graveyard USB restore: writes graveyard.sav and graveyard.pro straight into the
// calculator's storage over USB (WebUSB, DFU on the RAM interface), the way the official
// NumWorks site sends Python scripts. Mirrors the firmware's DFU code
// (ion/src/device/shared/usb/dfu_interface.cpp) and the game's stoFind/stoWrite.
// Never sends an empty DNLOAD (the calculator would leave DFU and restart, which wipes
// the storage) and never uses the flash interface or the erase command.
const GYUSB = (() => {
  const DNLOAD = 1, UPLOAD = 2, GETSTATUS = 3, CLRSTATUS = 4, ABORT = 6;
  const S_IDLE = 2, S_DNLOADIDLE = 5, S_ERROR = 10;
  const XFER = 2048, WCHUNK = 1024, RAM_ALT = 1;
  const STO_MAGIC = 0xEE0BDDBA;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

  class Dfu {
    constructor(dev, ifnum) { this.dev = dev; this.ifnum = ifnum; }
    setup(req, value) { return { requestType: "class", recipient: "interface", request: req, value, index: this.ifnum }; }
    async out(req, value, data) {
      if (req === DNLOAD && (!data || !data.length)) throw new Error("internal: empty download refused");
      const r = await this.dev.controlTransferOut(this.setup(req, value), data);
      if (r.status !== "ok") throw new Error("USB write was refused (" + r.status + ")");
    }
    async inn(req, value, len) {
      const r = await this.dev.controlTransferIn(this.setup(req, value), len);
      if (r.status !== "ok") throw new Error("USB read was refused (" + r.status + ")");
      return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    }
    async status() {
      let d;
      try { d = await this.inn(GETSTATUS, 0, 6); }
      catch (e) { await sleep(60); d = await this.inn(GETSTATUS, 0, 6); }   // one retry: some hosts report a busy device as a transfer error
      return { status: d[0], poll: d[1] | d[2] << 8 | d[3] << 16, state: d[4] };
    }
    async idle() {
      let s = await this.status();
      if (s.state === S_ERROR) { await this.dev.controlTransferOut(this.setup(CLRSTATUS, 0)); s = await this.status(); }
      if (s.state !== S_IDLE) { await this.dev.controlTransferOut(this.setup(ABORT, 0)); s = await this.status(); }
      if (s.state !== S_IDLE) throw new Error("the calculator is busy (state " + s.state + "); unplug it and try again");
    }
    async waitDownloadIdle() {
      for (let i = 0; i < 200; i++) {
        const s = await this.status();
        if (s.state === S_DNLOADIDLE) return;
        if (s.state === S_ERROR) throw new Error("the calculator refused that memory address");
        await sleep(Math.max(1, s.poll));
      }
      throw new Error("the calculator stopped answering");
    }
    async setAddress(a) {
      await this.idle();
      await this.out(DNLOAD, 0, Uint8Array.of(0x21, a & 255, a >>> 8 & 255, a >>> 16 & 255, a >>> 24 & 255));
      await this.waitDownloadIdle();
    }
    async read(addr, len) {
      await this.setAddress(addr);
      await this.dev.controlTransferOut(this.setup(ABORT, 0));
      const out = new Uint8Array(len);
      for (let off = 0, blk = 0; off < len; off += XFER, blk++) {
        const n = Math.min(XFER, len - off), d = await this.inn(UPLOAD, 2 + blk, n);
        if (d.length !== n) throw new Error("short read from the calculator");
        out.set(d, off);
      }
      await this.dev.controlTransferOut(this.setup(ABORT, 0));
      return out;
    }
    // write in small pieces, each at its own address (the way DfuSe tools do it)
    async write(addr, data, log) {
      for (let off = 0; off < data.length; off += WCHUNK) {
        const piece = data.subarray(off, Math.min(data.length, off + WCHUNK));
        if (log) log("  writing " + piece.length + " bytes at 0x" + ((addr + off) >>> 0).toString(16));
        await this.setAddress(addr + off);
        await this.out(DNLOAD, 2, piece);
        await this.waitDownloadIdle();
      }
      await this.dev.controlTransferOut(this.setup(ABORT, 0));
    }
    async read32(a) { return u32(await this.read(a, 4), 0); }
  }

  // open the calculator: the DFU interface, RAM alternate setting
  async function open(dev) {
    await dev.open();
    if (dev.configuration === null) await dev.selectConfiguration(1);
    let ifnum = -1;
    for (const itf of dev.configuration.interfaces)
      for (const alt of itf.alternates)
        if (alt.interfaceClass === 0xFE && alt.interfaceSubclass === 1) ifnum = itf.interfaceNumber;
    if (ifnum < 0) throw new Error("this device has no update interface; is it a NumWorks calculator?");
    await dev.claimInterface(ifnum);
    await dev.selectAlternateInterface(ifnum, RAM_ALT);
    return new Dfu(dev, ifnum);
  }

  // where the storage is: the same search as the game's stoFind
  const inRAM = a => (a >= 0x20000000 && a < 0x20080000) || (a >= 0x24000000 && a < 0x24100000);
  async function findStorage(dfu) {
    const SLOT = [0x90010000, 0x90410000, 0x90020000, 0x90420000];
    let n0110 = 0, n0120 = 0;
    for (let k = 0; k < 4; k++) if (await dfu.read32(SLOT[k]) === 0xDEC0EDFE) { if (k < 2) n0110++; else n0120++; }
    const n0120m = n0120 >= n0110;
    const vec = await dfu.read32(n0120m ? 0x24000004 : 0x20000004);
    const ul = (vec + (n0120m ? 0x20000 : 0x10000) - 8) >>> 0;
    if ((ul < 0x90000000 || ul >= 0x91000000) && !inRAM(ul)) throw new Error("could not find the calculator's storage (step 2)");
    const a = await dfu.read32(ul + 0xC), s = await dfu.read32(ul + 0x10);
    if (!inRAM(a) || !inRAM(a + s - 1) || s < 1024 || s > 0x40000) throw new Error("could not find the calculator's storage (step 3)");
    if (await dfu.read32(a) !== STO_MAGIC) throw new Error("could not find the calculator's storage (step 4)");
    return { addr: a, size: s, model: n0120m ? "N0120" : "N0110" };
  }

  // records [u16 size][name\0][data] after a 4-byte magic, ended by a zero size
  function records(buf) {
    if (u32(buf, 0) !== STO_MAGIC) throw new Error("the storage does not start the right way");
    const out = [];
    let p = 4;
    while (p + 2 <= buf.length) {
      const rs = buf[p] | buf[p + 1] << 8;
      if (!rs) break;
      if (rs < 3 || p + rs > buf.length) throw new Error("the storage looks damaged; not touching it");
      let e = p + 2;
      while (e < p + rs && buf[e]) e++;
      out.push({ start: p, size: rs, name: String.fromCharCode(...buf.subarray(p + 2, e)) });
      p += rs;
    }
    return { list: out, end: p };
  }

  // the storage with these files put in; returns the bytes from the start of the storage up to
  // its end marker, or throws if they don't fit. A file already there with the same size (the
  // game's two files always have the same size) is overwritten where it is, so nothing else
  // moves; new files go at the end. Only a file whose size changed is taken out and added again.
  function withFiles(buf, files) {
    const { list } = records(buf);
    const size = (name, data) => 2 + name.length + 1 + data.length;
    const moved = new Set(Object.keys(files).filter(n => { const r = list.find(x => x.name === n); return !r || r.size !== size(n, files[n]); }));
    const parts = [buf.subarray(0, 4)];
    for (const r of list) {
      if (moved.has(r.name)) continue;
      const rec = buf.slice(r.start, r.start + r.size);
      if (r.name in files) rec.set(files[r.name], 2 + r.name.length + 1);
      parts.push(rec);
    }
    for (const name of moved) {
      const data = files[name], rs = size(name, data), rec = new Uint8Array(rs);
      rec[0] = rs & 255; rec[1] = rs >> 8;
      for (let i = 0; i < name.length; i++) rec[2 + i] = name.charCodeAt(i);
      rec.set(data, 2 + name.length + 1);
      parts.push(rec);
    }
    parts.push(new Uint8Array(2));             // the end marker
    const len = parts.reduce((a, x) => a + x.length, 0);
    if (len > buf.length) throw new Error("the calculator's storage is too full; delete a Python script and try again");
    const out = new Uint8Array(len);
    let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  }

  // put the files in the calculator's storage. Only the bytes that change are written, and
  // the two bytes where the change starts go last: until then the calculator still sees its
  // old storage, so a transfer that breaks halfway leaves it as it was.
  async function restore(dfu, st, files, log) {
    const before = await dfu.read(st.addr, st.size);
    const out = withFiles(before, files);
    let d = 0;
    while (d < out.length && out[d] === before[d]) d++;
    if (d === out.length) { log("The calculator already has exactly this save."); return; }
    const head = Math.min(out.length, d + 2);
    log("Writing " + (out.length - d) + " bytes...");
    if (head < out.length) await dfu.write(st.addr + head, out.subarray(head), log);
    await dfu.write(st.addr + d, out.subarray(d, head), log);
    const after = await dfu.read(st.addr + d, out.length - d);
    if (!after.every((v, i) => v === out[d + i])) throw new Error("the calculator's memory didn't match after writing");
  }

  return { open, findStorage, records, withFiles, restore, Dfu };
})();
if (typeof module !== "undefined") module.exports = GYUSB;
