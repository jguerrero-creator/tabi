export const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

// AdvancedMarkerElement (TABI-153) requires a Map ID on every <Map>, unlike the
// legacy Marker it replaces. Falls back to Google's DEMO_MAP_ID (dev watermark)
// until a real Map ID is provisioned in Cloud Console — see .env.local.example.
export const mapId = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || 'DEMO_MAP_ID'

// TABI-135: the custom POI/road styling lives in cloud-based map styling (Cloud
// Console > Map Management > this Map ID), NOT as an inline `styles` prop on <Map>.
// The Maps JS API refuses to apply inline styles whenever a mapId is set (required
// here for AdvancedMarkerElement) — it logs a console warning and ignores them. The
// paste-ready style JSON lives at /google-maps-style.json in the repo root.

// Union of every library any screen needs (marker previews, place autocomplete).
// Must be a stable module-level reference — @vis.gl/react-google-maps's APIProvider
// re-runs its loader effect whenever this array's identity changes, so a fresh
// inline literal on every render was retriggering "already loaded with different
// parameters" warnings on every action, not just on first load.
export const MAPS_LIBRARIES: string[] = ['marker', 'places']
