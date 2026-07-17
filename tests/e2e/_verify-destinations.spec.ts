import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

test('create-trip form captures and displays destinations', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tripName = `E2E Destinations ${runId}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)

  let tripId: string | undefined
  try {
    await page.locator('header').getByRole('button', { name: 'New Trip' }).click()
    await expect(page.getByRole('heading', { name: 'New Trip' })).toBeVisible()

    await page.getByLabel('Trip name').fill(tripName)
    await page.getByLabel('Destination(s)').fill('Tokyo, Kyoto')

    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/trips') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create Trip' }).click(),
    ])

    const created = (await response.json()) as { id: string; destinations: string[] }
    tripId = created.id
    console.log('Created trip destinations (from insert response):', created.destinations)

    await expect(page.getByText(tripName)).toBeVisible()
    await expect(page.getByText('Tokyo, Kyoto')).toBeVisible()
  } finally {
    if (tripId) {
      const { error } = await client.from('trips').delete().eq('id', tripId)
      if (error) throw error
    }
  }
})
