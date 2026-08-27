import { useState, type ChangeEvent, type FormEvent } from 'react'
import { FormSheet } from '../../components/ui/FormSheet'
import {
  extractReservationFromImage,
  extractReservationFromPdf,
  extractReservationFromText,
  extractReservationFromUrl,
} from '../../lib/extractReservation'
import { strings } from '../../lib/strings'
import type { NewReservation, Reservation } from '../../types/reservation'
import { useTrip } from '../trips/useTrip'
import { AddReservationModal } from './AddReservationModal'
import { mapExtractedReservation, type ExtractedReservationPrefill } from './mapExtractedReservation'

interface ImportConfirmationModalProps {
  tripId: string
  onClose: () => void
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
}

// Comfortably under Claude's 32MB base64 document limit even after base64's ~37% size
// overhead — a booking confirmation PDF has no legitimate reason to approach either ceiling.
const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024

// Well under Claude's per-image size guidance (5MB pre-encoding) even after base64 overhead —
// a photo of a ticket/receipt has no legitimate reason to approach either ceiling.
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// TABI-15/23/58/193: import channels — paste text (TABI-12's original entry point), upload the
// email file itself (.eml/.txt, read client-side into the same textarea), upload a PDF
// confirmation (sent as a base64 document, since a PDF can't be read into a textarea), take/upload
// a photo of a ticket/receipt (sent as a base64 image), or paste a link to a confirmation page
// (fetched server-side in api/import-url.ts). All five feed the same extraction pipeline (TABI-8)
// and the same review/correction screen — no separate parsing path per channel, per the "one
// pipeline" rule. Text, PDF, photo, and URL are mutually exclusive (selecting one clears the
// others) since only one content block is sent per extraction call.
export function ImportConfirmationModal({ tripId, onClose, onCreate }: ImportConfirmationModalProps) {
  const { trip } = useTrip(tripId)
  const [text, setText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [pdfData, setPdfData] = useState<string | null>(null)
  const [pdfFileName, setPdfFileName] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [photoData, setPhotoData] = useState<string | null>(null)
  const [photoMediaType, setPhotoMediaType] = useState<string | null>(null)
  const [photoFileName, setPhotoFileName] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [prefill, setPrefill] = useState<ExtractedReservationPrefill | null>(null)
  const [manualFallback, setManualFallback] = useState(false)

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value)
    if (pdfData) {
      setPdfData(null)
      setPdfFileName(null)
    }
    if (photoData) {
      setPhotoData(null)
      setPhotoMediaType(null)
      setPhotoFileName(null)
    }
    if (url) setUrl('')
  }

  function handleUrlChange(event: ChangeEvent<HTMLInputElement>) {
    setUrl(event.target.value)
    if (text) setText('')
    if (pdfData) {
      setPdfData(null)
      setPdfFileName(null)
    }
    if (photoData) {
      setPhotoData(null)
      setPhotoMediaType(null)
      setPhotoFileName(null)
    }
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileError(null)
    setPdfData(null)
    setPdfFileName(null)
    const reader = new FileReader()
    reader.onload = () => setText(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => {
      console.error('ImportConfirmationModal: failed to read uploaded file', reader.error)
      setFileError(strings.importConfirmation.fileErrorGeneric)
    }
    reader.readAsText(file)
  }

  function handlePdfSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPdfError(null)
    if (file.size > MAX_PDF_SIZE_BYTES) {
      setPdfError(strings.importConfirmation.pdfSizeError)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.slice(result.indexOf(',') + 1)
      setText('')
      setUrl('')
      setPhotoData(null)
      setPhotoMediaType(null)
      setPhotoFileName(null)
      setPdfData(base64)
      setPdfFileName(file.name)
    }
    reader.onerror = () => {
      console.error('ImportConfirmationModal: failed to read uploaded PDF', reader.error)
      setPdfError(strings.importConfirmation.fileErrorGeneric)
    }
    reader.readAsDataURL(file)
  }

  function handleRemovePdf() {
    setPdfData(null)
    setPdfFileName(null)
    setPdfError(null)
  }

  function handlePhotoSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPhotoError(null)
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setPhotoError(strings.importConfirmation.photoTypeError)
      return
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setPhotoError(strings.importConfirmation.photoSizeError)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.slice(result.indexOf(',') + 1)
      setText('')
      setUrl('')
      setPdfData(null)
      setPdfFileName(null)
      setPhotoData(base64)
      setPhotoMediaType(file.type)
      setPhotoFileName(file.name)
    }
    reader.onerror = () => {
      console.error('ImportConfirmationModal: failed to read uploaded photo', reader.error)
      setPhotoError(strings.importConfirmation.fileErrorGeneric)
    }
    reader.readAsDataURL(file)
  }

  function handleRemovePhoto() {
    setPhotoData(null)
    setPhotoMediaType(null)
    setPhotoFileName(null)
    setPhotoError(null)
  }

  async function handleExtract(event: FormEvent) {
    event.preventDefault()
    if (!text.trim() && !pdfData && !photoData && !url.trim()) return
    setExtracting(true)
    setError(null)
    try {
      const result = photoData
        ? await extractReservationFromImage(photoData, photoMediaType ?? 'image/jpeg')
        : pdfData
          ? await extractReservationFromPdf(pdfData)
          : url.trim()
            ? await extractReservationFromUrl(url.trim())
            : await extractReservationFromText(text)
      setPrefill(mapExtractedReservation(result, trip?.currency ?? null))
    } catch {
      // TABI-11: fall back to manual entry rather than dead-ending on an extraction failure.
      setError(strings.importConfirmation.errorGeneric)
    } finally {
      setExtracting(false)
    }
  }

  if (prefill) {
    return (
      <AddReservationModal
        tripId={tripId}
        defaultType={prefill.defaultType}
        requireTypeChoice={prefill.requireTypeChoice}
        defaultStaySubtype={prefill.defaultStaySubtype}
        defaultTransportSubtype={prefill.defaultTransportSubtype}
        initialName={prefill.initialName}
        initialStartAddressText={prefill.initialStartAddressText}
        initialEndAddressText={prefill.initialEndAddressText}
        initialStartDate={prefill.initialStartDate}
        initialStartTime={prefill.initialStartTime}
        initialEndDate={prefill.initialEndDate}
        initialEndTime={prefill.initialEndTime}
        initialPriceAmount={prefill.initialPriceAmount}
        initialConfirmationNumber={prefill.initialConfirmationNumber}
        initialNote={prefill.initialNote}
        extractionNotice
        onClose={onClose}
        onCreate={onCreate}
      />
    )
  }

  if (manualFallback) {
    return <AddReservationModal tripId={tripId} requireTypeChoice onClose={onClose} onCreate={onCreate} />
  }

  return (
    <FormSheet
      title={strings.importConfirmation.title}
      onSubmit={handleExtract}
      onClose={onClose}
      cancelLabel={strings.importConfirmation.cancel}
      submitLabel={strings.importConfirmation.submit}
      submitting={extracting}
      submitDisabled={!text.trim() && !pdfData && !photoData && !url.trim()}
    >
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {strings.importConfirmation.textLabel}
        </span>
        <textarea
          id="import-confirmation-text"
          name="import-confirmation-text"
          value={text}
          onChange={handleTextChange}
          placeholder={strings.importConfirmation.textPlaceholder}
          rows={10}
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {strings.importConfirmation.fileLabel}
        </span>
        <input
          id="import-confirmation-file"
          name="import-confirmation-file"
          type="file"
          accept=".eml,.txt,message/rfc822,text/plain"
          onChange={handleFileSelect}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
      </label>
      {fileError && <p className="text-sm text-red-600">{fileError}</p>}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {strings.importConfirmation.pdfLabel}
        </span>
        <input
          id="import-confirmation-pdf"
          name="import-confirmation-pdf"
          type="file"
          accept=".pdf,application/pdf"
          onChange={handlePdfSelect}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
      </label>
      {pdfFileName && (
        <p className="text-sm text-slate-600">
          {strings.importConfirmation.pdfSelectedLabel(pdfFileName)}{' '}
          <button type="button" onClick={handleRemovePdf} className="text-teal-700 underline">
            {strings.importConfirmation.pdfRemoveCta}
          </button>
        </p>
      )}
      {pdfError && <p className="text-sm text-red-600">{pdfError}</p>}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {strings.importConfirmation.photoLabel}
        </span>
        <input
          id="import-confirmation-photo"
          name="import-confirmation-photo"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          capture="environment"
          onChange={handlePhotoSelect}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
      </label>
      {photoFileName && (
        <p className="text-sm text-slate-600">
          {strings.importConfirmation.photoSelectedLabel(photoFileName)}{' '}
          <button type="button" onClick={handleRemovePhoto} className="text-teal-700 underline">
            {strings.importConfirmation.photoRemoveCta}
          </button>
        </p>
      )}
      {photoError && <p className="text-sm text-red-600">{photoError}</p>}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">{strings.importConfirmation.urlLabel}</span>
        <input
          id="import-confirmation-url"
          name="import-confirmation-url"
          type="url"
          value={url}
          onChange={handleUrlChange}
          placeholder={strings.importConfirmation.urlPlaceholder}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </label>

      {extracting && <p className="text-sm text-slate-500">{strings.importConfirmation.extracting}</p>}

      {error && (
        <div className="space-y-2">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => setManualFallback(true)}
            className="text-sm text-teal-700 underline"
          >
            {strings.importConfirmation.manualFallbackCta}
          </button>
        </div>
      )}
    </FormSheet>
  )
}
