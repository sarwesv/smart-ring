"use strict";
// ── UUIDs ──────────────────────────────────────────────────────────────────
const RING_SERVICE = 'be940000-7333-be46-b7ae-689e71722bd5';
const CMD_CHAR_UUID = 'be940001-7333-be46-b7ae-689e71722bd5';
const HR_CHAR_UUID = 'be940003-7333-be46-b7ae-689e71722bd5';
const HR_SVC_UUID = '0000180d-0000-1000-8000-00805f9b34fb'; // Heart Rate (advertised)
const HR_STD_UUID = '00002a37-0000-1000-8000-00805f9b34fb';
const FEE7_SVC_UUID = '0000fee7-0000-1000-8000-00805f9b34fb'; // Vendor (advertised)
// ── CRC-16/CCITT (poly 0x1021, init 0xFFFF, result LE) ────────────────────
function crc16(body) {
    let crc = 0xFFFF;
    for (const b of body) {
        crc ^= b << 8;
        for (let i = 0; i < 8; i++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xFFFF;
        }
    }
    return [crc & 0xFF, (crc >> 8) & 0xFF];
}
function buildCmd(body) {
    const b = new Uint8Array(body);
    const [lo, hi] = crc16(b);
    const pkt = new Uint8Array(b.length + 2);
    pkt.set(b);
    pkt[b.length] = lo;
    pkt[b.length + 1] = hi;
    return pkt;
}
function buildTimeSyncCmd() {
    const now = new Date();
    const y = now.getFullYear();
    // JS: 0=Sun…6=Sat → ring: 0=Mon…6=Sun
    const jsDay = now.getDay();
    const ringDow = jsDay === 0 ? 6 : jsDay - 1;
    return buildCmd([
        0x01, 0x00, 0x0e, 0x00,
        y & 0xFF, (y >> 8) & 0xFF,
        now.getMonth() + 1, now.getDate(),
        now.getHours(), now.getMinutes(), now.getSeconds(),
        ringDow,
    ]);
}
// ── Init sequences ─────────────────────────────────────────────────────────
// Phase 1 ends with HR START (03:2f 01:00). Sending stop immediately after
// start cancels PPG within 0.2s — that's why phase 2 waits for 04:0e.
const PHASE1 = [
    [0x03, 0x09, 0x09, 0x00, 0x00, 0x00, 0x02],
    [0x05, 0x02, 0x06, 0x00],
    [0x05, 0x40, 0x07, 0x00, 0x02],
    [0x05, 0x04, 0x06, 0x00],
    [0x05, 0x41, 0x07, 0x00, 0x02],
    [0x05, 0x06, 0x06, 0x00],
    [0x05, 0x42, 0x07, 0x00, 0x02],
    [0x05, 0x08, 0x06, 0x00],
    [0x05, 0x43, 0x07, 0x00, 0x02],
    [0x05, 0x09, 0x06, 0x00],
    [0x05, 0x44, 0x07, 0x00, 0x02],
    [0x05, 0x33, 0x06, 0x00],
    [0x05, 0x4e, 0x07, 0x00, 0x02],
    [0x03, 0x09, 0x09, 0x00, 0x01, 0x00, 0x02],
    [0x02, 0x00, 0x08, 0x00, 0x47, 0x43],
    [0x02, 0x03, 0x08, 0x00, 0x47, 0x50],
    [0x03, 0x2f, 0x08, 0x00, 0x01, 0x00], // HR START — must be last
];
const PHASE2 = [
    [0x04, 0x0e, 0x07, 0x00, 0x00], // ack ring's readiness signal
    [0x03, 0x2f, 0x08, 0x00, 0x00, 0x00], // HR stop/ack (safe after PPG capture)
    [0x03, 0x09, 0x09, 0x00, 0x00, 0x00, 0x02],
    [0x05, 0x02, 0x06, 0x00],
    [0x05, 0x40, 0x07, 0x00, 0x02],
    [0x05, 0x04, 0x06, 0x00],
    [0x05, 0x41, 0x07, 0x00, 0x02],
    [0x05, 0x06, 0x06, 0x00],
    [0x05, 0x42, 0x07, 0x00, 0x02],
    [0x05, 0x08, 0x06, 0x00],
    [0x05, 0x43, 0x07, 0x00, 0x02],
    [0x05, 0x09, 0x06, 0x00],
    [0x05, 0x44, 0x07, 0x00, 0x02],
    [0x05, 0x33, 0x06, 0x00],
    [0x05, 0x4e, 0x07, 0x00, 0x02],
    [0x03, 0x09, 0x09, 0x00, 0x01, 0x00, 0x02],
    [0x02, 0x00, 0x08, 0x00, 0x47, 0x43],
    [0x02, 0x03, 0x08, 0x00, 0x47, 0x50],
];
// ── Helpers ────────────────────────────────────────────────────────────────
function toHex(arr) {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');
}
// writeValueWithResponse is in the newer Web Bluetooth spec; fall back to writeValue
async function writeWithResponse(char, data) {
    if (typeof char.writeValueWithResponse === 'function') {
        await char.writeValueWithResponse(data);
    }
    else {
        await char.writeValue(data);
    }
}
function log(msg, level = 'default') {
    const el = document.getElementById('logEl');
    const line = document.createElement('div');
    line.className = 'log-line' + (level !== 'default' ? ' ' + level : '');
    line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
    el.prepend(line);
    while (el.children.length > 300)
        el.removeChild(el.lastChild);
}
function setStatus(text, cls) {
    const el = document.getElementById('statusEl');
    el.className = 'status ' + cls;
    document.getElementById('statusText').textContent = text;
}
function setHR(bpm, source = '') {
    const valEl = document.getElementById('hrVal');
    const arc = document.getElementById('arc');
    const srcEl = document.getElementById('hrSrc');
    if (bpm === null) {
        valEl.textContent = '--';
        valEl.className = 'hr-value';
        arc.setAttribute('style', 'stroke-dashoffset:565');
        srcEl.textContent = '';
        return;
    }
    valEl.textContent = String(bpm);
    srcEl.textContent = source;
    // Color zone: green <90, yellow 90-110, red >110
    const zone = bpm < 90 ? 'ok' : bpm < 110 ? 'warn' : 'high';
    valEl.className = 'hr-value ' + zone;
    arc.className = 'arc-fill ' + zone;
    // Arc: 40 bpm = 0%, 200 bpm = 100%
    const pct = Math.min(1, Math.max(0, (bpm - 40) / 160));
    const offset = (565 * (1 - pct)).toFixed(1);
    arc.setAttribute('style', `stroke-dashoffset:${offset}`);
}
function setActivity(steps, cal, hrCache) {
    document.getElementById('stepsVal').textContent = steps.toLocaleString();
    document.getElementById('calVal').textContent = String(cal);
    document.getElementById('hrCacheVal').textContent = String(hrCache);
}
// ── State ──────────────────────────────────────────────────────────────────
let writeChar = null;
let phase2Triggered = false;
let liveHRActive = false;
// ── Notification handlers ──────────────────────────────────────────────────
function checkReadiness(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0x04 && bytes[1] === 0x0e && !phase2Triggered) {
        phase2Triggered = true;
        log('Ring signalled readiness → starting Phase 2', 'info');
        runPhase2().catch(e => log('Phase 2 error: ' + e, 'warn'));
    }
}
function onCmdChar(event) {
    const v = event.target.value;
    const bytes = new Uint8Array(v.buffer);
    log('[BE940001] ' + toHex(bytes));
    checkReadiness(bytes);
}
function onHRChar(event) {
    const v = event.target.value;
    const bytes = new Uint8Array(v.buffer);
    checkReadiness(bytes);
    if (bytes.length < 2)
        return;
    const cmd = bytes[0], sub = bytes[1];
    if (cmd === 0x06 && sub === 0x00) {
        log('[BE940003] Measuring... (sensor warming up)', 'info');
        setStatus('Sensor warming up (~20s)', 'connected');
    }
    else if (cmd === 0x06 && sub === 0x01 && bytes.length >= 5) {
        const hr = bytes[4];
        liveHRActive = true;
        setHR(hr, 'live · BE940003');
        log('[BE940003] HEART RATE (live)  ' + hr + ' bpm', 'hr');
        setStatus('Streaming live HR', 'connected');
    }
    else {
        log('[BE940003] ' + toHex(bytes));
    }
}
function onHRStd(event) {
    const v = event.target.value;
    const bytes = new Uint8Array(v.buffer);
    if (bytes.length < 2)
        return;
    const isU16 = (bytes[0] & 0x01) !== 0;
    const hr = isU16 ? bytes[1] | (bytes[2] << 8) : bytes[1];
    log('[2A37] HR (BLE std)  ' + hr + ' bpm');
    if (!liveHRActive)
        setHR(hr, 'std · 2A37');
}
function onActivity(event) {
    const v = event.target.value;
    const bytes = new Uint8Array(v.buffer);
    if (bytes[0] === 0x07 && bytes.length >= 8) {
        const steps = bytes[1] | (bytes[2] << 8);
        const cal = bytes[4] | (bytes[5] << 8);
        const hrCache = bytes[7];
        setActivity(steps, cal, hrCache);
        log('[FEA1] steps=' + steps + '  cal=' + cal + '  hr_cached=' + hrCache);
    }
}
// ── Init phases ────────────────────────────────────────────────────────────
async function runPhase1() {
    const ts = buildTimeSyncCmd();
    log('[time-sync] ' + toHex(ts), 'info');
    await writeWithResponse(writeChar, ts);
    for (let i = 0; i < PHASE1.length; i++) {
        const pkt = buildCmd(PHASE1[i]);
        const label = i === PHASE1.length - 1 ? ' ← HR START' : '';
        log('[p1 ' + (i + 1) + '/' + PHASE1.length + '] ' + toHex(pkt) + label);
        await writeWithResponse(writeChar, pkt);
    }
    log('Phase 1 complete — waiting for ring readiness (~20s)', 'info');
    setStatus('Sensor warming up (~20s)', 'connected');
}
async function runPhase2() {
    for (let i = 0; i < PHASE2.length; i++) {
        const pkt = buildCmd(PHASE2[i]);
        log('[p2 ' + (i + 1) + '/' + PHASE2.length + '] ' + toHex(pkt));
        await writeWithResponse(writeChar, pkt);
    }
    log('Phase 2 complete', 'info');
}
// ── Connect / disconnect ───────────────────────────────────────────────────
async function connect() {
    const btn = document.getElementById('connectBtn');
    if (!navigator.bluetooth) {
        setStatus('Web Bluetooth not supported', 'error');
        log('Use Chrome or Edge on desktop. Safari and Firefox do not support Web Bluetooth.', 'warn');
        return;
    }
    btn.disabled = true;
    setStatus('Scanning...', 'connecting');
    log('Opening device picker...', 'info');
    try {
        // Filter by FEE7 — the ring advertises this service UUID in its primary
        // advertisement packet (confirmed via CoreBluetooth). BE940000 is NOT
        // advertised, so Chrome hides the device if that's the only optionalService.
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [FEE7_SVC_UUID] }],
            optionalServices: [RING_SERVICE, HR_SVC_UUID, FEE7_SVC_UUID],
        });
        log('Found: ' + device.name, 'info');
        setStatus('Connecting...', 'connecting');
        device.addEventListener('gattserverdisconnected', () => {
            setStatus('Disconnected', 'idle');
            setHR(null);
            log('Disconnected from ring', 'warn');
            btn.disabled = false;
            btn.textContent = 'Connect Ring';
            btn.className = 'connect-btn';
            btn.onclick = () => connect();
            phase2Triggered = false;
            liveHRActive = false;
            writeChar = null;
        });
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(RING_SERVICE);
        // Command channel — write here, receive acks
        writeChar = await service.getCharacteristic(CMD_CHAR_UUID);
        await writeChar.startNotifications();
        writeChar.addEventListener('characteristicvaluechanged', onCmdChar);
        // Live HR channel — receive 06:00 (warming) and 06:01 (reading)
        const hrChar = await service.getCharacteristic(HR_CHAR_UUID);
        await hrChar.startNotifications();
        hrChar.addEventListener('characteristicvaluechanged', onHRChar);
        // Standard BLE HR (optional, less accurate, useful before live HR kicks in)
        try {
            const hrSvc = await server.getPrimaryService(HR_SVC_UUID);
            const hrStdChr = await hrSvc.getCharacteristic(HR_STD_UUID);
            await hrStdChr.startNotifications();
            hrStdChr.addEventListener('characteristicvaluechanged', onHRStd);
            log('2A37 (BLE std HR) subscribed', 'info');
        }
        catch {
            log('2A37 not available on this ring', 'info');
        }
        // Activity data — only accessible if FEA1's parent service UUID is known.
        // The FEA1 characteristic is under a service we haven't identified yet;
        // skipping for now so the connect doesn't fail.
        setStatus('Connected — initializing', 'connected');
        btn.disabled = false;
        btn.textContent = 'Disconnect';
        btn.className = 'connect-btn secondary';
        btn.onclick = () => device.gatt.disconnect();
        await runPhase1();
    }
    catch (e) {
        const err = e;
        if (err.name === 'NotFoundError') {
            setStatus('No device selected', 'idle');
            log('Device picker closed without selecting a device', 'warn');
        }
        else {
            setStatus('Error: ' + err.message, 'error');
            log('ERROR: ' + err, 'warn');
        }
        btn.disabled = false;
        btn.textContent = 'Connect Ring';
        btn.className = 'connect-btn';
        btn.onclick = connect;
    }
}
// ── Boot ───────────────────────────────────────────────────────────────────
document.getElementById('connectBtn').onclick = connect;
