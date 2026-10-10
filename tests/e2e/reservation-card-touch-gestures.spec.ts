import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Touch-only interactions on a Planning reservation card (DayColumn.tsx): the
// swipe-left-to-reveal-note gesture and the drag-handle-based move (TABI-195).
// Neither had any e2e coverage before this spec (Backlog: permanent touch coverage
// for Planning cards) — this was written as a regression check for the "push icon/
// text left" and "wrap name onto two lines" card-layout changes (both pure CSS, no
// handler/logic changes), and is kept here as a head start on that Backlog item
// rather than thrown away.
//
// Chromium's native Touch/TouchEvent constructors only exist when the browser
// context declares touch support, so this needs `hasTouch: true` — real
// touchstart/touchmove/touchend events are dispatched by hand (Playwright's own
// `page.touchscreen` has no move/swipe primitive).

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const DAY_KEY = '2026-11-05'

async function dispatchTouch(
  locator: import('@playwright/test').Locator,
  type: 'touchstart' | 'touchmove' | 'touchend',
  x: number,
  y: number,
) {
  await locator.evaluate(
    (el, { type, x, y }) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
      const event = new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        targetTouches: type === 'touchend' ? [] : [touch],
        bubbles: true,
        cancelable: true,
      })
      el.dispatchEvent(event)
    },
    { type, x, y },
  )
}

test('swipe reveals the note button and opens the popup; the drag handle moves a reservation onto a free block', async ({
  page,
  registerTrip,
}) => {
  test.setTimeout(30000)
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
    .insert({ organizer_id: user.id, name: `E2E card-touch trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  const activityName = `E2E swipe-drag activity ${runId}`

  try {
    const { data: reservation, error: insertError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'activity',
        activity_subtype: 'place',
        status: 'booked',
        name: activityName,
        start_at: `${DAY_KEY}T11:00:00.000Z`,
        start_timezone: 'UTC',
        end_at: null,
      })
      .select()
      .single()
    if (insertError || !reservation) throw insertError ?? new Error('Reservation insert returned no row')

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()
    await page.getByRole('button', { name: /Nov 5/ }).click()

    const mobileView = page.getByTestId('mobile-day-view')
    const cardRow = mobileView.locator('li').filter({ hasText: activityName })
    await expect(cardRow).toBeVisible()

    // --- Swipe-to-reveal note ---
    const slidingDiv = cardRow.locator('.touch-pan-y')
    const box = await slidingDiv.boundingBox()
    if (!box) throw new Error('sliding card div not found')
    const startX = box.x + box.width - 20
    const y = box.y + box.height / 2

    await dispatchTouch(slidingDiv, 'touchstart', startX, y)
    await dispatchTouch(slidingDiv, 'touchmove', startX - 90, y)
    await dispatchTouch(slidingDiv, 'touchend', startX - 90, y)

    const transform = await slidingDiv.evaluate((el) => (el as HTMLElement).style.transform)
    expect(transform).toContain('-72')

    const noteButton = cardRow.getByRole('button', { name: /note/i }).first()
    await expect(noteButton).toBeVisible()
    await noteButton.click()
    await expect(page.locator('textarea')).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()

    // A plain tap still navigates to the detail screen, unaffected by the swipe/drag
    // affordances on the same card. Clicking the note button above already closed the
    // swipe reveal (`setOpen(false)`), so the card is back in its resting position.
    await cardRow.getByText(activityName).click()
    await expect(page.getByRole('heading', { name: activityName })).toBeVisible()
    await page.goBack()
    await expect(cardRow).toBeVisible()

    // --- Drag-and-drop: drag the card onto the free block right after it ---
    const handle = cardRow.getByLabel('Press and hold to move')
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('drag handle not found')

    const freeBlock = mobileView.locator('[data-drop-target="free"]').last()
    const freeBox = await freeBlock.boundingBox()
    if (!freeBox) throw new Error('free block not found')
    const targetTime = await freeBlock.getAttribute('data-time')
    if (!targetTime) throw new Error('free block has no data-time')

    const hx = handleBox.x + handleBox.width / 2
    const hy = handleBox.y + handleBox.height / 2
    await dispatchTouch(handle, 'touchstart', hx, hy)
    await expect(page.getByTestId('reservation-drag-ghost')).toBeVisible()

    const fx = freeBox.x + freeBox.width / 2
    const fy = freeBox.y + freeBox.height / 2
    await dispatchTouch(handle, 'touchmove', fx, fy)
    await page.waitForTimeout(100)
    await dispatchTouch(handle, 'touchend', fx, fy)

    await expect(page.getByTestId('reservation-drag-ghost')).not.toBeVisible()
    await page.waitForTimeout(500)

    const { data: moved, error: moveReadError } = await client
      .from('reservations')
      .select('start_at')
      .eq('id', reservation.id)
      .single()
    if (moveReadError || !moved) throw moveReadError ?? new Error('Could not re-read moved reservation')
    expect(Date.parse(moved.start_at!)).toBe(Date.parse(targetTime))
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
