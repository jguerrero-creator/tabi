import { useEffect, useState } from 'react'
import { GeolocationUnavailableError, getCurrentPosition } from '../../lib/geolocation'
import { logClientError } from '../../lib/logError'
import { showSavedToast } from '../../lib/toast'
import { strings } from '../../lib/strings'
import { Spinner } from '../../components/ui/Spinner'
import type { Json } from '../../types/database.types'
import type { NewReservation, Reservation } from '../../types/reservation'
import { ActivityPlaceSearchModal } from './ActivityPlaceSearchModal'
import { AddReservationModal, type ResolvedPlace } from './AddReservationModal'
import { NearbyPlacesMapModal } from './NearbyPlacesMapModal'

interface SavePlaceModalProps {
  tripId: string
  onClose: () => void
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
}

type Step =
  | { kind: 'locating' }
  | { kind: 'nearby'; center: { lat: number; lng: number } }
  | { kind: 'search' }
  | { kind: 'form'; place: ResolvedPlace | null }
  | { kind: 'saving' }

// TABI-20: "spot a place while out and about, save it as To book" — a one-tap
// shortcut that skips the full Add sheet entirely for the common case (the place
// resolves from geolocation or a text search), unlike TABI-24's nearby-places flow
// which always routes a selection into AddReservationModal. Saved with no start_at
// (an unscheduled Activity, per the existing UNSCHEDULED_KEY grouping) since the
// use case is "remember to book this", not "schedule it" — the user assigns it a
// day later, from the reservation detail screen, once they've actually booked it.
export function SavePlaceModal({ tripId, onClose, onCreate }: SavePlaceModalProps) {
  const [step, setStep] = useState<Step>({ kind: 'locating' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getCurrentPosition()
      .then((center) => {
        if (!cancelled) setStep({ kind: 'nearby', center })
      })
      .catch((err) => {
        if (cancelled) return
        if (!(err instanceof GeolocationUnavailableError)) {
          logClientError('SavePlaceModal.getCurrentPosition', err)
        }
        setError(strings.savePlace.locationDenied)
        setStep({ kind: 'search' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSelect(place: ResolvedPlace) {
    setStep({ kind: 'saving' })
    setError(null)
    try {
      await onCreate({
        type: 'activity',
        status: 'to_book',
        name: place.placeName ?? place.formattedAddress,
        start_address: place.formattedAddress,
        start_lat: place.lat,
        start_lng: place.lng,
        start_place_name: place.placeName,
        start_city: place.city,
        place_google_id: place.placeDetails?.googlePlaceId ?? null,
        place_rating: place.placeDetails?.rating ?? null,
        place_user_ratings_total: place.placeDetails?.userRatingsTotal ?? null,
        place_photo_ref: place.placeDetails?.photoRef ?? null,
        place_category: place.placeDetails?.category ?? null,
        place_opening_hours: (place.placeDetails?.openingHours ?? null) as Json | null,
      })
      showSavedToast(strings.savePlace.savedMessage)
      onClose()
    } catch (err) {
      logClientError('SavePlaceModal.handleSelect', err)
      setError(strings.savePlace.saveErrorGeneric)
      setStep({ kind: 'search' })
    }
  }

  const errorBanner = error && (
    <div className="fixed inset-x-0 top-0 z-[70] flex justify-center px-4 pt-4">
      <p className="rounded-full bg-red-600 px-4 py-2 text-center text-xs font-medium text-white shadow-lg">
        {error}
      </p>
    </div>
  )

  if (step.kind === 'locating' || step.kind === 'saving') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
        <div className="flex items-center gap-2 rounded-2xl bg-white px-6 py-5 text-sm text-slate-600 shadow-lg">
          <Spinner />
          <span>{step.kind === 'locating' ? strings.savePlace.locating : strings.savePlace.saving}</span>
        </div>
      </div>
    )
  }

  if (step.kind === 'nearby') {
    return (
      <NearbyPlacesMapModal
        center={step.center}
        onSelect={handleSelect}
        onSkip={() => setStep({ kind: 'search' })}
        onCancel={onClose}
      />
    )
  }

  if (step.kind === 'search') {
    return (
      <>
        {errorBanner}
        <ActivityPlaceSearchModal
          tripId={tripId}
          onSelect={handleSelect}
          onSkip={() => setStep({ kind: 'form', place: null })}
          onCancel={onClose}
        />
      </>
    )
  }

  return (
    <AddReservationModal
      tripId={tripId}
      defaultType="activity"
      requireTypeChoice={false}
      initialStartPlace={step.place}
      initialName={step.place?.placeName ?? null}
      onClose={onClose}
      onCreate={onCreate}
    />
  )
}
