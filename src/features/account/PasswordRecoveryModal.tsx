import { useState, type FormEvent } from 'react'
import { FormSheet } from '../../components/ui/FormSheet'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { supabase } from '../../lib/supabase'
import { showSavedToast } from '../../lib/toast'

interface PasswordRecoveryModalProps {
  onClose: () => void
}

// TABI-44 follow-up: shown app-wide whenever Supabase fires PASSWORD_RECOVERY
// (the user clicked a reset-password email link, which already authenticates
// them as that user) — see the onAuthStateChange listener in App.tsx.
export function PasswordRecoveryModal({ onClose }: PasswordRecoveryModalProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirmPassword) {
      setError(strings.account.errorPasswordMismatch)
      return
    }
    if (password.length < 8) {
      setError(strings.account.errorPasswordTooShort)
      return
    }

    setSubmitting(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (updateError) {
      logClientError('PasswordRecoveryModal.handleSubmit', updateError)
      setError(updateError.code === 'weak_password' ? updateError.message : strings.account.errorGeneric)
      return
    }

    showSavedToast(strings.account.passwordUpdatedToast)
    onClose()
  }

  return (
    <FormSheet
      title={strings.account.recoveryTitle}
      onSubmit={handleSubmit}
      onClose={onClose}
      cancelLabel={strings.account.cancel}
      submitLabel={strings.account.saveCta}
      submitting={submitting}
      submitDisabled={!password || !confirmPassword}
    >
      <p className="text-sm text-slate-600">{strings.account.recoveryIntro}</p>
      <div>
        <label htmlFor="account-recovery-password" className="mb-1 block text-sm font-medium text-slate-700">
          {strings.account.passwordLabel}
        </label>
        <input
          id="account-recovery-password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="account-recovery-confirm-password" className="mb-1 block text-sm font-medium text-slate-700">
          {strings.account.confirmPasswordLabel}
        </label>
        <input
          id="account-recovery-confirm-password"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </FormSheet>
  )
}
