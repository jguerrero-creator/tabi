import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { activitySeed } from './support/reservationSeeds'

// Backlog: "Notes rapides du Planning : icône colorée quand une note existe
// (grise sinon) et grande fenêtre sur desktop" — the note icon on a
// reservation card (DayColumn.tsx's SwipeableReservationCard) is colour when
// a note exists and greyscale when it doesn't, and on desktop (pointer-fine,
// same convention the strip itself already used to pick between the swipe
// reveal and the persistent strip) clicking it opens a large near-fullscreen
// modal (ReservationNoteModal) instead of the small popup mobile keeps.

const LONG_NOTE =
  'Remember: front desk closes at 22:00, call ahead if arriving later. Confirm dietary restrictions with the host before check-in. Bring printed boarding pass copies just in case the app glitches again like last time.'

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('note icon is grey when empty, coloured when a note exists, and the desktop icon opens a large editor', async ({
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
      .insert({ organizer_id: user.id, name: `E2E note-icon trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
      .select()
      .single()
    if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
    registerTrip(client, trip.id)

    const noNoteName = `E2E no-note activity ${runId}`
    const hasNoteName = `E2E has-note activity ${runId}`

    const { error: insertNoNoteError } = await client.from('reservations').insert(
      activitySeed({
        trip_id: trip.id,
        type: 'activity',
        status: 'booked',
        name: noNoteName,
        start_at: '2026-09-20T06:00:00.000Z',
        start_timezone: 'Asia/Tokyo',
        end_at: null,
      }),
    )
    if (insertNoNoteError) throw insertNoNoteError

    const { error: insertHasNoteError } = await client.from('reservations').insert(
      activitySeed({
        trip_id: trip.id,
        type: 'activity',
        status: 'booked',
        name: hasNoteName,
        start_at: '2026-09-20T09:00:00.000Z',
        start_timezone: 'Asia/Tokyo',
        end_at: null,
        note: LONG_NOTE,
      }),
    )
    if (insertHasNoteError) throw insertHasNoteError

    await page.goto(`/trips/${trip.id}?tab=planning`)
    const carousel = page.getByTestId('desktop-day-carousel')
    await expect(carousel.getByText(noNoteName)).toBeVisible()
    await expect(carousel.getByText(hasNoteName)).toBeVisible()

    const noNoteCard = carousel.locator('li').filter({ hasText: noNoteName })
    const hasNoteCard = carousel.locator('li').filter({ hasText: hasNoteName })

    // State-aware icon: grey/empty vs coloured/has-note, before touching anything.
    const noNoteButton = noNoteCard.getByRole('button', { name: 'Note (empty)' })
    const hasNoteButton = hasNoteCard.getByRole('button', { name: 'Note (has note)' })
    await expect(noNoteButton).toBeVisible()
    await expect(hasNoteButton).toBeVisible()
    await expect(noNoteButton.locator('span').first()).toHaveClass(/grayscale/)
    await expect(hasNoteButton.locator('span').first()).not.toHaveClass(/grayscale/)

    await page.screenshot({ path: 'test-results/screenshots/note-icon-states-desktop.png' })

    // Desktop click opens the large editor, not the small popup.
    await hasNoteButton.click()
    const modalTextarea = page.locator('textarea')
    await expect(modalTextarea).toBeVisible()
    await expect(modalTextarea).toHaveValue(LONG_NOTE)
    const modalContainer = page.locator('div.max-w-4xl')
    await expect(modalContainer).toBeVisible()
    const modalBox = await modalContainer.boundingBox()
    expect(modalBox?.width ?? 0).toBeGreaterThan(800)
    expect(modalBox?.height ?? 0).toBeGreaterThan(700)

    await page.screenshot({ path: 'test-results/screenshots/note-modal-large-desktop.png' })

    // Escape + discard-confirm: edit without saving, dismiss, change must not persist.
    await modalTextarea.fill(`${LONG_NOTE} EDITED-BUT-DISCARDED`)
    page.once('dialog', (dialog) => dialog.accept())
    await page.keyboard.press('Escape')
    await expect(modalTextarea).not.toBeVisible()
    await hasNoteButton.click()
    await expect(page.locator('textarea')).toHaveValue(LONG_NOTE)

    // Clear the note via the large editor -> icon turns grey, no reload.
    await page.locator('textarea').fill('   ')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Saved')).toBeVisible()
    await expect(page.locator('textarea')).not.toBeVisible()
    await expect(hasNoteCard.getByRole('button', { name: 'Note (empty)' }).locator('span').first()).toHaveClass(/grayscale/)

    // Write a note into the previously-empty card -> icon turns colour, no reload.
    await noNoteButton.click()
    await page.locator('textarea').fill('New note added during verification.')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Saved')).toBeVisible()
    await expect(page.locator('textarea')).not.toBeVisible()
    const updatedNoNoteButton = noNoteCard.getByRole('button', { name: 'Note (has note)' })
    await expect(updatedNoNoteButton).toBeVisible()
    await expect(updatedNoNoteButton.locator('span').first()).not.toHaveClass(/grayscale/)

    await page.screenshot({ path: 'test-results/screenshots/note-icon-updated-desktop.png' })

    // A plain click on the card (not the note icon) still opens the detail screen.
    await noNoteCard.getByRole('link', { name: new RegExp(noNoteName) }).click()
    await expect(page.getByRole('heading', { name: noNoteName })).toBeVisible()
  })
})

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('swipe reveal shows the right note-icon state and still opens the small popup', async ({ page, registerTrip }) => {
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
      .insert({ organizer_id: user.id, name: `E2E note-icon mobile trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
      .select()
      .single()
    if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
    registerTrip(client, trip.id)

    const noNoteName = `E2E mobile no-note activity ${runId}`
    const hasNoteName = `E2E mobile has-note activity ${runId}`

    const { error: insertNoNoteError } = await client.from('reservations').insert(
      activitySeed({
        trip_id: trip.id,
        type: 'activity',
        status: 'booked',
        name: noNoteName,
        start_at: '2026-09-21T06:00:00.000Z',
        start_timezone: 'Asia/Tokyo',
        end_at: null,
      }),
    )
    if (insertNoNoteError) throw insertNoNoteError

    const { error: insertHasNoteError } = await client.from('reservations').insert(
      activitySeed({
        trip_id: trip.id,
        type: 'activity',
        status: 'booked',
        name: hasNoteName,
        start_at: '2026-09-21T09:00:00.000Z',
        start_timezone: 'Asia/Tokyo',
        end_at: null,
        note: 'Already have a note.',
      }),
    )
    if (insertHasNoteError) throw insertHasNoteError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()

    const mobileView = page.getByTestId('mobile-day-view')
    await expect(mobileView.getByText(noNoteName)).toBeVisible()
    await expect(mobileView.getByText(hasNoteName)).toBeVisible()

    const noNoteCard = mobileView.locator('li').filter({ hasText: noNoteName })
    const hasNoteCard = mobileView.locator('li').filter({ hasText: hasNoteName })

    // Icon state is readable from the DOM regardless of whether the swipe
    // reveal is currently open (it's absolutely positioned under the card).
    await expect(noNoteCard.getByRole('button', { name: 'Note (empty)' }).locator('span').first()).toHaveClass(
      /grayscale/,
    )
    await expect(hasNoteCard.getByRole('button', { name: 'Note (has note)' }).locator('span').first()).not.toHaveClass(
      /grayscale/,
    )

    // Swipe the no-note card left to reveal its note button, then tap it.
    const swipeRow = noNoteCard.locator('.touch-pan-y')
    const box = await swipeRow.boundingBox()
    if (!box) throw new Error('Swipe row has no bounding box')
    const y = box.y + box.height / 2
    const startX = box.x + box.width - 10
    const endX = startX - 100
    // Dispatched as three separate evaluate() round-trips (not one synchronous
    // batch) so React actually flushes the touchmove-driven setDragX between
    // them — touchend reads the latest `dragX` via a closure captured at the
    // last render, which otherwise still sees the pre-move value.
    await swipeRow.evaluate(
      (el, { startX, y }) => {
        const touch = new Touch({ identifier: 1, target: el, clientX: startX, clientY: y })
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }))
      },
      { startX, y },
    )
    await swipeRow.evaluate(
      (el, { endX, y }) => {
        const touch = new Touch({ identifier: 1, target: el, clientX: endX, clientY: y })
        el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch] }))
      },
      { endX, y },
    )
    await swipeRow.evaluate(
      (el, { endX, y }) => {
        const touch = new Touch({ identifier: 1, target: el, clientX: endX, clientY: y })
        el.dispatchEvent(
          new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [touch] }),
        )
      },
      { endX, y },
    )

    const revealedButton = noNoteCard.getByRole('button', { name: 'Note (empty)' })
    await expect(revealedButton).toBeVisible()

    await page.screenshot({ path: 'test-results/screenshots/note-icon-states-mobile.png' })

    await revealedButton.click()
    const popup = page.locator('textarea')
    await expect(popup).toBeVisible()
    // The small popup, not the large desktop editor — same sheet, 'max-w-sm'.
    const sheetContainer = page.locator('div.max-w-sm')
    await expect(sheetContainer).toBeVisible()
    await expect(page.locator('div.max-w-4xl')).toHaveCount(0)

    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(popup).not.toBeVisible()

    // Plain tap on the card still opens the detail screen.
    await noNoteCard.locator('a').first().click()
    await expect(page.getByRole('heading', { name: noNoteName })).toBeVisible()
  })
})
