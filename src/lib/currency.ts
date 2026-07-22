export function formatCurrency(amount: number, currencyCode: string): string {
  if (!currencyCode) return amount.toFixed(2)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`
  }
}
