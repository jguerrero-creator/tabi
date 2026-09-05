import { useEffect, useState, type FormEvent } from 'react'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FormSheet } from '../../components/ui/FormSheet'
import { Spinner } from '../../components/ui/Spinner'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { supabase } from '../../lib/supabase'
import { showSavedToast } from '../../lib/toast'

type Mode = 'loading' | 'signed-in' | 'create' | 'login'
type CreateStep = 'details' | 'code' | 'password-retry' | 'success'

interface AccountModalProps {
  onClose: () => void
}

// TABI-44: converts the current anonymous session into a real email/password
// account in place (supabase.auth.updateUser -> verifyOtp -> updateUser), so
// auth.uid() never changes and every RLS-scoped row stays attached with no
// migration. Password can only be set once the email is verified, hence the
// 'details' -> 'code' -> password step machine rather than a single submit.
export function AccountModal({ onClose }: AccountModalProps) {
  const [mode, setMode] = useState<Mode>('loading')
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null)
  const [createStep, setCreateStep] = useState<CreateStep>('details')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data, error: userError }) => {
      if (cancelled) return
      if (userError || !data.user) {
        if (userError) logClientError('AccountModal.getUser', userError)
        setMode('create')
        return
      }
      if (data.user.is_anonymous) {
        setMode('create')
      } else {
        setSignedInEmail(data.user.email ?? null)
        setMode('signed-in')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  function switchMode(next: 'create' | 'login', prefillEmail?: string) {
    setMode(next)
    setCreateStep('details')
    setError(null)
    setPassword('')
    setConfirmPassword('')
    setCode('')
    setLoginPassword('')
    if (prefillEmail !== undefined) setEmail(prefillEmail)
  }

  function mapEmailUpdateError(updateError: { code?: string }): string {
    if (updateError.code === 'email_exists') return strings.account.errorEmailExists
    if (updateError.code === 'manual_linking_disabled') return strings.account.errorManualLinkingDisabled
    return strings.account.errorGeneric
  }

  async function handleDetailsSubmit(event: FormEvent) {
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
    const { error: updateError } = await supabase.auth.updateUser({ email: email.trim() })
    setSubmitting(false)

    if (updateError) {
      logClientError('AccountModal.handleDetailsSubmit', updateError)
      setError(mapEmailUpdateError(updateError))
      return
    }

    setCreateStep('code')
  }

  async function handleResendCode() {
    setSubmitting(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ email: email.trim() })
    setSubmitting(false)

    if (updateError) {
      logClientError('AccountModal.handleResendCode', updateError)
      setError(mapEmailUpdateError(updateError))
    }
  }

  async function handleCodeSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email_change',
    })

    if (verifyError) {
      setSubmitting(false)
      logClientError('AccountModal.handleCodeSubmit.verify', verifyError)
      setError(
        verifyError.code === 'over_email_send_rate_limit'
          ? strings.account.errorRateLimited
          : strings.account.errorCodeInvalid,
      )
      return
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (passwordError) {
      logClientError('AccountModal.handleCodeSubmit.password', passwordError)
      setError(passwordError.code === 'weak_password' ? passwordError.message : strings.account.errorGeneric)
      setCreateStep('password-retry')
      return
    }

    setCreateStep('success')
    showSavedToast(strings.account.savedToast)
  }

  async function handlePasswordRetrySubmit(event: FormEvent) {
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
    const { error: passwordError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (passwordError) {
      logClientError('AccountModal.handlePasswordRetrySubmit', passwordError)
      setError(passwordError.code === 'weak_password' ? passwordError.message : strings.account.errorGeneric)
      return
    }

    setCreateStep('success')
    showSavedToast(strings.account.savedToast)
  }

  async function handleLoginSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: loginPassword,
    })

    if (signInError) {
      setSubmitting(false)
      logClientError('AccountModal.handleLoginSubmit', signInError)
      setError(
        signInError.code === 'invalid_credentials'
          ? strings.account.errorInvalidCredentials
          : strings.account.errorGeneric,
      )
      return
    }

    // Hard reload: login swaps in a different auth.uid() than whatever anon
    // session was active, and nothing in the app listens for auth changes
    // (useTrips/useProfile both fetch once on mount) — a reload guarantees
    // every hook re-fetches under the new session.
    window.location.href = '/'
  }

  if (mode === 'loading') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <Spinner />
      </div>
    )
  }

  if (mode === 'signed-in') {
    return (
      <ConfirmDialog
        title={strings.account.accountCta}
        message={`${strings.account.signedInAs} ${signedInEmail}. ${strings.account.signedInHint}`}
        confirmLabel={strings.account.close}
        onConfirm={onClose}
      />
    )
  }

  if (mode === 'login') {
    return (
      <FormSheet
        title={strings.account.logInTitle}
        onSubmit={handleLoginSubmit}
        onClose={onClose}
        cancelLabel={strings.account.cancel}
        submitLabel={strings.account.logInCta}
        submitting={submitting}
        submitDisabled={!email.trim() || !loginPassword}
      >
        <div>
          <label htmlFor="account-login-email" className="mb-1 block text-sm font-medium text-slate-700">
            {strings.account.emailLabel}
          </label>
          <input
            id="account-login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={strings.account.emailPlaceholder}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="account-login-password" className="mb-1 block text-sm font-medium text-slate-700">
            {strings.account.passwordLabel}
          </label>
          <input
            id="account-login-password"
            type="password"
            required
            autoComplete="current-password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => switchMode('create')}
          className="text-sm text-teal-700 underline hover:text-teal-800"
        >
          {strings.account.switchToCreate}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </FormSheet>
    )
  }

  // mode === 'create'
  if (createStep === 'success') {
    return (
      <ConfirmDialog
        title={strings.account.successTitle}
        message={strings.account.successBody(email)}
        confirmLabel={strings.account.close}
        onConfirm={onClose}
      />
    )
  }

  if (createStep === 'code') {
    return (
      <FormSheet
        title={strings.account.codeTitle}
        onSubmit={handleCodeSubmit}
        onClose={onClose}
        cancelLabel={strings.account.cancel}
        submitLabel={strings.account.verifyCta}
        submitting={submitting}
        submitDisabled={!code.trim()}
      >
        <p className="text-sm text-slate-600">{strings.account.codeIntro(email)}</p>
        <div>
          <label htmlFor="account-code" className="mb-1 block text-sm font-medium text-slate-700">
            {strings.account.codeLabel}
          </label>
          <input
            id="account-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={strings.account.codePlaceholder}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={handleResendCode}
          disabled={submitting}
          className="text-sm text-teal-700 underline hover:text-teal-800 disabled:opacity-50"
        >
          {strings.account.resendCta}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </FormSheet>
    )
  }

  if (createStep === 'password-retry') {
    return (
      <FormSheet
        title={strings.account.passwordRetryTitle}
        onSubmit={handlePasswordRetrySubmit}
        onClose={onClose}
        cancelLabel={strings.account.cancel}
        submitLabel={strings.account.saveCta}
        submitting={submitting}
        submitDisabled={!password || !confirmPassword}
      >
        <p className="text-sm text-slate-600">{strings.account.passwordRetryIntro}</p>
        <div>
          <label htmlFor="account-password-retry" className="mb-1 block text-sm font-medium text-slate-700">
            {strings.account.passwordLabel}
          </label>
          <input
            id="account-password-retry"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="account-confirm-password-retry" className="mb-1 block text-sm font-medium text-slate-700">
            {strings.account.confirmPasswordLabel}
          </label>
          <input
            id="account-confirm-password-retry"
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

  // createStep === 'details'
  return (
    <FormSheet
      title={strings.account.createTitle}
      onSubmit={handleDetailsSubmit}
      onClose={onClose}
      cancelLabel={strings.account.cancel}
      submitLabel={strings.account.continueCta}
      submitting={submitting}
      submitDisabled={!email.trim() || !password || !confirmPassword}
    >
      <p className="text-sm text-slate-600">{strings.account.createIntro}</p>
      <div>
        <label htmlFor="account-email" className="mb-1 block text-sm font-medium text-slate-700">
          {strings.account.emailLabel}
        </label>
        <input
          id="account-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={strings.account.emailPlaceholder}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="account-password" className="mb-1 block text-sm font-medium text-slate-700">
          {strings.account.passwordLabel}
        </label>
        <input
          id="account-password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="account-confirm-password" className="mb-1 block text-sm font-medium text-slate-700">
          {strings.account.confirmPasswordLabel}
        </label>
        <input
          id="account-confirm-password"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={() => switchMode('login')}
        className="text-sm text-teal-700 underline hover:text-teal-800"
      >
        {strings.account.switchToLogIn}
      </button>
      {error && (
        <p className="text-sm text-red-600">
          {error}
          {error === strings.account.errorEmailExists && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => switchMode('login', email)}
                className="underline hover:text-red-700"
              >
                {strings.account.errorEmailExistsLogInLink}
              </button>
            </>
          )}
        </p>
      )}
    </FormSheet>
  )
}
