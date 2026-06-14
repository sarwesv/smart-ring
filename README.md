# TK5 Ring Monitor

A browser-based live heart rate monitor for the TK5 smart ring, built with Web Bluetooth.

**Live app:** https://sarwesv.github.io/smart-ring/

---

## Usage

1. Open the app in **Chrome or Edge** (Safari and Firefox do not support Web Bluetooth)
2. Click **Connect Ring**
3. Select **TK5 28DC** from the device picker
4. Wait ~20 seconds for the PPG sensor to warm up
5. Live heart rate streams automatically

## How it works

The app reverse-engineers the TK5's proprietary BLE protocol:

- Connects to the `BE940000` vendor service and subscribes to indications on `BE940001` (command acks) and `BE940003` (live HR stream)
- Sends a two-phase init sequence — Phase 1 ends with an HR START command; Phase 2 is triggered by the ring's `04:0e` readiness signal ~20s later
- All proprietary packets use CRC-16/CCITT (poly `0x1021`, init `0xFFFF`, little-endian)
- Live HR readings arrive as `06 01 ... [bpm] ...` indications on `BE940003`

See the companion Swift CLI at [ring/claude](../claude) for the full protocol documentation.

## Stack

- TypeScript compiled to vanilla JS — no framework, no bundler
- Web Bluetooth API (`navigator.bluetooth`)
- Hosted on GitHub Pages
