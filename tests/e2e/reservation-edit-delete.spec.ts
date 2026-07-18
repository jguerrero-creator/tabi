import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-27 — "Édition / suppression d'une réservation". Verifies both halves
// on the shared detail screen: editing a field persists to the DB and is
// reflected in the UI, and deleting (after confirming the dialog) removes
// the row and navigates away.

test('a reservation can be edited and deleted from the detail screen', async ({ page }) => {
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
    .insert({
      organizer_id: user.id,
      name: `E2E edit/delete trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    const { data: reservation, error: reservationError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'activity',
        name: `E2E activity ${runId}`,
        start_at: '2026-09-01T10:00:00.000Z',
      })
      .select()
      .single()
    if (reservationError || !reservation) throw reservationError ?? new Error('Reservation insert returned no row')

    await page.goto(`/reservations/${reservation.id}`)
    await expect(page.getByRole('heading', { name: `E2E activity ${runId}` })).toBeVisible()

    // Edit: change the name and a note, save, and confirm it persisted (both
    // in the UI and via a direct re-fetch from the DB).
    await page.getByRole('button', { name: 'Edit' }).click()
    const updatedName = `E2E activity EDITED ${runId}`
    await page.getByLabel('Name').fill(updatedName)
    await page.getByLabel('Notes').fill('Edited via e2e test')

    const [updateResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: 'Save' }).click(),
    ])
    expect(updateResponse.ok()).toBe(true)

    await expect(page.getByRole('heading', { name: updatedName })).toBeVisible()
    await expect(page.getByText('Edited via e2e test')).toBeVisible()

    const { data: afterEdit, error: afterEditError } = await client
      .from('reservations')
      .select('*')
      .eq('id', reservation.id)
      .single()
    if (afterEditError) throw afterEditError
    expect(afterEdit.name).toBe(updatedName)
    expect(afterEdit.note).toBe('Edited via e2e test')

    // Delete: confirm dialog, then verify navigation away and DB removal.
    page.once('dialog', (dialog) => dialog.accept())
    const [deleteResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'DELETE',
      ),
      page.getByRole('button', { name: 'Delete' }).click(),
    ])
    expect(deleteResponse.ok()).toBe(true)

    await expect(page.getByRole('heading', { name: updatedName })).toHaveCount(0)

    const { data: afterDelete, error: afterDeleteError } = await client
      .from('reservations')
      .select('*')
      .eq('id', reservation.id)
      .maybeSingle()
    if (afterDeleteError) throw afterDeleteError
    expect(afterDelete).toBeNull()
  } finally {
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
