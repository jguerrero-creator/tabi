export const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

// AdvancedMarkerElement (TABI-153) requires a Map ID on every <Map>, unlike the
// legacy Marker it replaces. Falls back to Google's DEMO_MAP_ID (dev watermark)
// until a real Map ID is provisioned in Cloud Console — see .env.local.example.
export const mapId = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || 'DEMO_MAP_ID'

// Union of every library any screen needs (marker previews, place autocomplete).
// Must be a stable module-level reference — @vis.gl/react-google-maps's APIProvider
// re-runs its loader effect whenever this array's identity changes, so a fresh
// inline literal on every render was retriggering "already loaded with different
// parameters" warnings on every action, not just on first load.
export const MAPS_LIBRARIES: string[] = ['marker', 'places']
