import { useEffect, useState } from 'react'
import { Field } from '../../components/ui/Field'
import { strings } from '../../lib/strings'

interface BudgetConverterProps {
  tripId: string
}

type ConverterOperation = 'multiply' | 'divide'

interface ConverterState {
  amount: string
  rate: string
  operation: ConverterOperation
}

const EMPTY_STATE: ConverterState = { amount: '', rate: '', operation: 'multiply' }

function storageKey(tripId: string) {
  return `tabi:budgetConverter:${tripId}`
}

function loadState(tripId: string): ConverterState {
  try {
    const raw = sessionStorage.getItem(storageKey(tripId))
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw)
    return {
      amount: typeof parsed.amount === 'string' ? parsed.amount : '',
      rate: typeof parsed.rate === 'string' ? parsed.rate : '',
      operation: parsed.operation === 'divide' ? 'divide' : 'multiply',
    }
  } catch {
    return EMPTY_STATE
  }
}

/**
 * Scratch calculator only — never reads or writes reservation/budget data
 * (CLAUDE.md #1: single trip currency, no per-reservation conversion).
 * State persists per-trip for the browser session (sessionStorage) so the
 * user isn't re-entering a manual rate on every visit during the trip.
 */
export function BudgetConverter({ tripId }: BudgetConverterProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ConverterState>(EMPTY_STATE)

  useEffect(() => {
    if (!tripId) return
    setState(loadState(tripId))
  }, [tripId])

  useEffect(() => {
    if (!tripId) return
    try {
      sessionStorage.setItem(storageKey(tripId), JSON.stringify(state))
    } catch {
      // sessionStorage unavailable (private mode, etc.) — converter still works for this render
    }
  }, [tripId, state])

  const parsedAmount = Number(state.amount)
  const parsedRate = Number(state.rate)
  const canCompute =
    state.amount.trim() !== '' &&
    state.rate.trim() !== '' &&
    Number.isFinite(parsedAmount) &&
    Number.isFinite(parsedRate) &&
    (state.operation === 'multiply' || parsedRate !== 0)
  const result = canCompute
    ? state.operation === 'multiply'
      ? parsedAmount * parsedRate
      : parsedAmount / parsedRate
    : null

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-slate-700">{strings.budgetConverter.title}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-200 px-4 py-3">
          <Field label={strings.budgetConverter.amountPlaceholder} className="text-xs">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={state.amount}
              onChange={(event) => setState((prev) => ({ ...prev, amount: event.target.value }))}
              placeholder={strings.budgetConverter.amountPlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </Field>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label={strings.budgetConverter.rateHint(state.operation)} className="text-xs">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  value={state.rate}
                  onChange={(event) => setState((prev) => ({ ...prev, rate: event.target.value }))}
                  placeholder={strings.budgetConverter.ratePlaceholder}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </Field>
            </div>
            <button
              type="button"
              onClick={() =>
                setState((prev) => ({ ...prev, operation: prev.operation === 'multiply' ? 'divide' : 'multiply' }))
              }
              aria-label={strings.budgetConverter.toggleAriaLabel(state.operation)}
              className="flex h-[38px] w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-base font-medium text-slate-700 hover:bg-slate-50"
            >
              {state.operation === 'multiply' ? '×' : '÷'}
            </button>
          </div>
          <p className="pt-1 text-sm">
            {result != null ? (
              <span className="font-semibold text-slate-900">
                {strings.budgetConverter.resultPrefix}{' '}
                {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(result)}
              </span>
            ) : (
              <span className="text-slate-400">{strings.budgetConverter.incomplete}</span>
            )}
          </p>
        </div>
      )}
    </section>
  )
}
