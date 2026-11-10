export function formatCurrency(amount: number, currencyCode: string): string {
  if (!currencyCode) return amount.toFixed(2)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`
  }
}

/**
 * TABI-263: the minor-unit step for largest-remainder rounding (1 for JPY, 0.01 for
 * EUR/USD) — read from Intl itself rather than hardcoding a currency list, so it
 * stays correct for every ISO 4217 code the trip-currency selector offers.
 */
export function currencyMinorUnitStep(currencyCode: string): number {
  try {
    const { maximumFractionDigits } = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).resolvedOptions()
    return 10 ** -(maximumFractionDigits ?? 2)
  } catch {
    return 0.01
  }
}
