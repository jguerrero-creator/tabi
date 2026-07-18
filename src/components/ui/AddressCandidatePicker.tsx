import type { GeocodeCandidate } from '../../lib/geocode'
import { strings } from '../../lib/strings'
import { Button } from './Button'

interface AddressCandidatePickerProps {
  candidates: GeocodeCandidate[]
  onSelect: (candidate: GeocodeCandidate) => void
  onCancel: () => void
}

export function AddressCandidatePicker({ candidates, onSelect, onCancel }: AddressCandidatePickerProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">{strings.addressPicker.title}</h2>
        <div role="radiogroup" className="space-y-2">
          {candidates.map((candidate) => (
            <button
              key={candidate.placeId}
              type="button"
              role="radio"
              aria-checked={false}
              onClick={() => onSelect(candidate)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-teal-600 hover:bg-teal-50"
            >
              {candidate.formattedAddress}
            </button>
          ))}
        </div>
        <div className="flex justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {strings.addressPicker.cancel}
          </Button>
        </div>
      </div>
    </div>
  )
}
