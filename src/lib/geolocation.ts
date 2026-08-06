export class GeolocationUnavailableError extends Error {}

// TABI-20: one-shot current-position lookup for the "save a place" quick action —
// no watch/subscription needed, the user just wants a search center for "right now".
export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeolocationUnavailableError('Geolocation is not supported in this browser.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  })
}
