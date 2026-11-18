// Apply before generated scripts, matching Cockpit Tools' isolated preview.
// HTTP CSP remains the authority, including when the route is opened directly.
const PREVIEW_LOCKDOWN = `(() => {
  for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'RTCDataChannel', 'WebTransport']) {
    try { Object.defineProperty(globalThis, key, {value: undefined, writable: false, configurable: false}); } catch (_) {}
  }
  for (const key of ['alert', 'confirm', 'prompt', 'print']) {
    try { Object.defineProperty(globalThis, key, {value: () => undefined, writable: false, configurable: false}); } catch (_) {}
  }
})()`

export function drawingPreviewDocument(source: string): string {
  // A standards-mode shell also works for standalone SVG. Keep the entire model
  // source intact after the guard; do not alter its geometry, styles or scripts.
  return `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><script>${PREVIEW_LOCKDOWN}</script>${source}`
}
