import { BackgroundGeolocation } from '@capgo/background-geolocation';

const API_BASE = 'https://api.eatswada.com';
const INTENT_KEY = 'eatswada_rider_background_tracking';
let running = false;
let startPromise = null;

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
function token() {
  try { return localStorage.getItem('riderToken') || ''; } catch { return ''; }
}
function isNativeAndroid() {
  const cap = window.Capacitor;
  return !!(cap && cap.isNativePlatform && cap.isNativePlatform() &&
    cap.getPlatform && cap.getPlatform() === 'android');
}

async function start() {
  if (!isNativeAndroid()) return { native: false };
  if (running) return { native: true, running: true };
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const jwt = token();
    if (!jwt) throw new Error('Please sign in again before enabling location tracking.');
    const permission = await BackgroundGeolocation.requestPermissions({ permissions: ['location', 'notification'] });
    if (permission.location !== 'granted') throw new Error('Allow location permission to go online.');
    if (permission.notification && permission.notification !== 'granted') {
      throw new Error('Allow notifications so Android can show the active tracking notice.');
    }
    await BackgroundGeolocation.start({
      backgroundTitle: 'Eatswada Rider is online',
      backgroundMessage: 'Location is active while you are available for deliveries. Tap to return to Eatswada.',
      requestPermissions: false,
      stale: false,
      distanceFilter: 0,
      minIntervalMs: 15000,
      networkFallback: true
      // Deliberately no native `url`: this plugin uses POST, but the existing
      // Eatswada location route is PUT. The live WebView forwards fixes using
      // the existing API contract; backend changes are intentionally excluded.
    }, (location, error) => {
      if (error) {
        emit('eatswada:background-location-error', { message: error.message || 'Background location failed', code: error.code });
        return;
      }
      if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) return;
      emit('eatswada:background-location', {
        lat: Number(location.latitude),
        lng: Number(location.longitude),
        accuracy: Number(location.accuracy) || null,
        time: Number(location.time) || Date.now()
      });
    });
    running = true;
    try { localStorage.setItem(INTENT_KEY, '1'); } catch {}
    emit('eatswada:background-location-state', { running: true });
    return { native: true, running: true };
  })().finally(() => { startPromise = null; });
  return startPromise;
}

async function stop() {
  if (isNativeAndroid()) await BackgroundGeolocation.stop();
  running = false;
  try { localStorage.removeItem(INTENT_KEY); } catch {}
  emit('eatswada:background-location-state', { running: false });
  return { running: false };
}
async function resumeIfRequested() {
  let requested = false;
  try { requested = localStorage.getItem(INTENT_KEY) === '1'; } catch {}
  if (!requested) return false;
  try { await start(); return true; }
  catch (error) { emit('eatswada:background-location-error', { message: error.message || 'Could not resume location tracking' }); return false; }
}
window.RiderBackgroundLocation = { start, stop, resumeIfRequested, isNativeAndroid };
window.dispatchEvent(new CustomEvent('eatswada:background-location-ready'));
