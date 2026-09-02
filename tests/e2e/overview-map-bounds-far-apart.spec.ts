import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Bugs DB: "centerOf(points) calcule probablement une moyenne naïve lat/lng" (Majeur).
// A naive lat/lng average of Tokyo + Brussels (~9700km apart) lands in rural
// Kazakhstan, nowhere near either city — MiniMap.tsx's old 2-point `midpoint()`
// had the same issue, and picked `points[0]` outright for 3+ points. Both now use
// `mapCameraFor()` (defaultBounds + fitBounds), which frames every point regardless
// of spread. This asserts both markers are actually visible inside the map viewport,
// not just that the page didn't crash.

function reservation(tripId: string, name: string, lat: number, lng: number) {
  return {
    trip_id: tripId,
    type: 'stay',
    stay_subtype: 'hotel',
    status: 'booked',
    name: `far-apart-${name}`,
    start_at: '2026-09-10T06:00:00.000Z',
    start_timezone: 'Asia/Tokyo',
    end_at: '2026-09-12T02:00:00.000Z',
    end_timezone: 'Asia/Tokyo',
    start_lat: lat,
    start_lng: lng,
    start_place_name: name,
  }
}

async function expectMarkerInsideContainer(
  container: import('@playwright/test').Locator,
  title: string,
  containerBox: { x: number; y: number; width: number; height: number },
) {
  const marker = container.getByTitle(title)
  await expect(marker).toBeVisible()
  const box = await marker.boundingBox()
  if (!box) throw new Error(`No bounding box for marker "${title}"`)
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  expect(centerX).toBeGreaterThanOrEqual(containerBox.x)
  expect(centerX).toBeLessThanOrEqual(containerBox.x + containerBox.width)
  expect(centerY).toBeGreaterThanOrEqual(containerBox.y)
  expect(centerY).toBeLessThanOrEqual(containerBox.y + containerBox.height)
}

test('Overview map frames both Tokyo and Brussels even though they are ~9700km apart', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()

  const client = await authenticatedClientFor(page)
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: trip, error: tripError } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name: `E2E far-apart trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: reservationError } = await client
      .from('reservations')
      .insert([reservation(trip.id, 'Tokyo', 35.6762, 139.6503), reservation(trip.id, 'Brussels', 50.8503, 4.3517)])
    if (reservationError) throw reservationError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

    // Normal (MiniMap) view.
    const normalMap = page.getByTestId('map').first()
    await expect(normalMap).toBeVisible()
    const normalBox = await normalMap.boundingBox()
    if (!normalBox) throw new Error('No bounding box for the normal map')
    await expectMarkerInsideContainer(normalMap, 'Tokyo', normalBox)
    await expectMarkerInsideContainer(normalMap, 'Brussels', normalBox)

    // Fullscreen view — MiniMap stays mounted underneath, so marker lookups must
    // be scoped to this container or "Tokyo"/"Brussels" would match twice.
    await page.getByRole('button', { name: 'Expand map' }).click()
    const fullscreenMap = page.locator('.fixed.inset-0.z-50')
    await expect(fullscreenMap).toBeVisible()
    const fullscreenBox = await fullscreenMap.boundingBox()
    if (!fullscreenBox) throw new Error('No bounding box for the fullscreen map')
    await expectMarkerInsideContainer(fullscreenMap, 'Tokyo', fullscreenBox)
    await expectMarkerInsideContainer(fullscreenMap, 'Brussels', fullscreenBox)
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
