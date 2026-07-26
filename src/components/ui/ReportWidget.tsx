import { useEffect, useState, type FormEvent } from 'react'
import { strings } from '../../lib/strings'
import { FormSheet } from './FormSheet'

type ReportKind = 'bug' | 'feedback'
type Step = 'menu' | 'form'
type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

const SUCCESS_AUTO_CLOSE_MS = 1400

const FEEDBACK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Bug', label: 'Bug' },
  { value: 'Amélioration UX', label: 'UX improvement' },
  { value: 'Idée nouvelle feature', label: 'New feature idea' },
  { value: 'Observation terrain', label: 'Field observation' },
  { value: 'Conversation', label: 'Conversation' },
]

// TABI-171: globally accessible floating "Report a bug or feedback" action so
// findings during manual testing (e.g. the Japan end-to-end run) land in
// Notion without switching apps. Sits above BottomNav on mobile (z-20 vs its
// z-10); desktop has no bottom nav, so it just floats bottom-right. The
// button opens a 2-choice menu first — Bug writes to the "Bugs" Notion
// database, Feedback writes to "Field Test Log — Japon" instead, via the
// same server route.
export function ReportWidget() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('menu')
  const [kind, setKind] = useState<ReportKind | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [feedbackType, setFeedbackType] = useState(FEEDBACK_TYPE_OPTIONS[0].value)
  const [context, setContext] = useState('')
  const [state, setState] = useState<SubmitState>('idle')

  useEffect(() => {
    if (state !== 'success') return
    const timer = setTimeout(() => close(), SUCCESS_AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  function close() {
    setOpen(false)
    setStep('menu')
    setKind(null)
    setTitle('')
    setDescription('')
    setFeedbackType(FEEDBACK_TYPE_OPTIONS[0].value)
    setContext('')
    setState('idle')
  }

  function chooseKind(nextKind: ReportKind) {
    setKind(nextKind)
    setStep('form')
  }

  function backToMenu() {
    setStep('menu')
    setKind(null)
    setTitle('')
    setDescription('')
    setFeedbackType(FEEDBACK_TYPE_OPTIONS[0].value)
    setContext('')
    setState('idle')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || state === 'submitting' || !kind) return

    setState('submitting')
    try {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          kind === 'feedback'
            ? {
                kind,
                title: title.trim(),
                description: description.trim(),
                type: feedbackType,
                context: context.trim(),
              }
            : { kind, title: title.trim(), description: description.trim() },
        ),
      })
      if (!response.ok) throw new Error('report request failed')
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
        aria-label={strings.report.trigger}
        className="fixed bottom-24 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-700 lg:bottom-6"
      >
        <BugIcon className="h-5 w-5" />
      </button>

      {open && step === 'menu' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-sm rounded-t-2xl bg-white p-6 sm:rounded-2xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">{strings.report.menuTitle}</h2>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => chooseKind('bug')}
                className="rounded-lg border border-slate-300 px-4 py-3 text-left text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                {strings.report.menuBugLabel}
              </button>
              <button
                type="button"
                onClick={() => chooseKind('feedback')}
                className="rounded-lg border border-slate-300 px-4 py-3 text-left text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                {strings.report.menuFeedbackLabel}
              </button>
              <button
                type="button"
                onClick={close}
                className="mt-2 self-center text-sm text-slate-500 hover:text-slate-700"
              >
                {strings.report.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {open && step === 'form' && kind && (
        <FormSheet
          title={kind === 'bug' ? strings.report.bugFormTitle : strings.report.feedbackFormTitle}
          onSubmit={handleSubmit}
          onClose={state === 'success' ? close : backToMenu}
          cancelLabel={state === 'success' ? strings.report.closeCta : strings.report.back}
          submitLabel={strings.report.submit}
          submitting={state === 'submitting'}
          submitDisabled={!title.trim() || state === 'success'}
        >
          {state === 'success' ? (
            <p className="text-sm text-slate-600">{strings.report.successMessage}</p>
          ) : (
            <>
              <div>
                <label htmlFor="report-title" className="mb-1 block text-sm font-medium text-slate-700">
                  {strings.report.titleLabel}
                </label>
                <input
                  id="report-title"
                  type="text"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={
                    kind === 'bug' ? strings.report.bugTitlePlaceholder : strings.report.feedbackTitlePlaceholder
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>

              {kind === 'feedback' && (
                <div>
                  <label htmlFor="report-type" className="mb-1 block text-sm font-medium text-slate-700">
                    {strings.report.typeLabel}
                  </label>
                  <select
                    id="report-type"
                    value={feedbackType}
                    onChange={(event) => setFeedbackType(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    {FEEDBACK_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="report-description" className="mb-1 block text-sm font-medium text-slate-700">
                  {kind === 'bug' ? strings.report.descriptionLabel : strings.report.feedbackDescriptionLabel}
                </label>
                <textarea
                  id="report-description"
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={
                    kind === 'bug'
                      ? strings.report.bugDescriptionPlaceholder
                      : strings.report.feedbackDescriptionPlaceholder
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>

              {kind === 'feedback' && (
                <div>
                  <label htmlFor="report-context" className="mb-1 block text-sm font-medium text-slate-700">
                    {strings.report.contextLabel}
                  </label>
                  <input
                    id="report-context"
                    type="text"
                    value={context}
                    onChange={(event) => setContext(event.target.value)}
                    placeholder={strings.report.contextPlaceholder}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              )}

              {state === 'error' && <p className="text-sm text-red-600">{strings.report.errorMessage}</p>}
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
