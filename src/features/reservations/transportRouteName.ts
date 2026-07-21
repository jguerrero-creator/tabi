/**
 * TABI-122: point-to-point transport (flight/train/local transport) has no free-text
 * name field — the name is always derived from its route, so it can't drift out of
 * sync with the addresses. "At disposal" transport (e.g. car rental) keeps a free name.
 */
export function transportRouteName(
  startPlaceName: string | null,
  startAddress: string | null,
  endPlaceName: string | null,
  endAddress: string | null,
): string {
  const start = startPlaceName ?? startAddress ?? ''
  const end = endPlaceName ?? endAddress ?? ''
  return `${start} → ${end}`
}
