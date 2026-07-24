import { useEffect, useState, type FormEvent } from 'react'
import { strings } from '../../lib/strings'
import { FormSheet } from './FormSheet'

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

const SUCCESS_AUTO_CLOSE_MS = 1400

// TABI-171: globally accessible floating "Report a bug" action so bugs found
// mid-testing (e.g. the Japan end-to-end run) land in Notion without
// switching apps. Sits above BottomNav on mobile (z-20 vs its z-10); desktop
// has no bottom nav, so it just floats bottom-right.
export function ReportBugWidget() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [state, setState] = useState<SubmitState>('idle')

  useEffect(() => {
    if (state !== 'success') return
    const timer = setTimeout(() => close(), SUCCESS_AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  function close() {
    setOpen(false)
    setTitle('')
    setDescription('')
    setState('idle')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || state === 'submitting') return

    setState('submitting')
    try {
      const response = await fetch('/api/report-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      })
      if (!response.ok) throw new Error('report-bug request failed')
      setState('success')
    } catch {
      setState('error')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={strings.reportBug.trigger}
        className="fixed bottom-24 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-700 lg:bottom-6"
      >
        <BugIcon className="h-5 w-5" />
      </button>

      {open && (
        <FormSheet
          title={strings.reportBug.title}
          onSubmit={handleSubmit}
          onClose={close}
          cancelLabel={state === 'success' ? strings.reportBug.closeCta : strings.reportBug.cancel}
          submitLabel={strings.reportBug.submit}
          submitting={state === 'submitting'}
          submitDisabled={!title.trim() || state === 'success'}
        >
          {state === 'success' ? (
            <p className="text-sm text-slate-600">{strings.reportBug.successMessage}</p>
          ) : (
            <>
              <div>
                <label htmlFor="bug-title" className="mb-1 block text-sm font-medium text-slate-700">
                  {strings.reportBug.titleLabel}
                </label>
                <input
                  id="bug-title"
                  type="text"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={strings.reportBug.titlePlaceholder}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="bug-description" className="mb-1 block text-sm font-medium text-slate-700">
                  {strings.reportBug.descriptionLabel}
                </label>
                <textarea
                  id="bug-description"
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={strings.reportBug.descriptionPlaceholder}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              {state === 'error' && <p className="text-sm text-red-600">{strings.reportBug.errorMessage}</p>}
            </>
          )}
        </FormSheet>
      )}
    </>
  )
}

function BugIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="8" y="8" width="8" height="10" rx="4" />
      <path d="M12 8V5" />
      <path d="m9 5-2-2" />
      <path d="m15 5 2-2" />
      <path d="m4 11 4 1" />
      <path d="m20 11-4 1" />
      <path d="m4 16 4-1" />
      <path d="m20 16-4-1" />
      <path d="M9 18v2" />
      <path d="M15 18v2" />
    </svg>
  )
}
