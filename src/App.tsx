import { APIProvider } from '@vis.gl/react-google-maps'
import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { TripLayout } from './components/menu/TripLayout'
import { ReportWidget } from './components/ui/ReportWidget'
import { SavedToast } from './components/ui/SavedToast'
import { ActivitiesMenuScreen } from './features/activities/ActivitiesMenuScreen'
import { PasswordRecoveryModal } from './features/account/PasswordRecoveryModal'
import { BudgetMenuScreen } from './features/budget/BudgetMenuScreen'
import { PrivacyPolicyScreen } from './features/legal/PrivacyPolicyScreen'
import { ReservationDetailScreen } from './features/reservations/ReservationDetailScreen'
import { SouvenirsMenuScreen } from './features/souvenirs/SouvenirsMenuScreen'
import { StayMenuScreen } from './features/stay/StayMenuScreen'
import { TransportMenuScreen } from './features/transport/TransportMenuScreen'
import { OverviewScreen } from './features/trips/OverviewScreen'
import { TripsListScreen } from './features/trips/TripsListScreen'
import { MAPS_LIBRARIES, mapsApiKey } from './lib/googleMaps'
import { supabase } from './lib/supabase'

// Single Maps JS API load for the whole app lifecycle (never unmounted, unlike the
// per-screen/per-modal APIProviders this replaced — those mounted and unmounted on
// every navigation and every Add-sheet open, each with its own libraries array,
// which made the Maps loader think its parameters kept changing and spammed
// "already been loaded with different parameters" on nearly every action).
export function App() {
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false)

  // TABI-44 follow-up: Supabase fires this when the user lands here via a
  // password-reset email link (already authenticated as that user at this
  // point) — mounted app-wide, not per-screen, since the link can land on
  // any route.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setShowPasswordRecovery(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <APIProvider apiKey={mapsApiKey ?? ''} libraries={MAPS_LIBRARIES}>
      <Routes>
        <Route path="/" element={<TripsListScreen />} />
        <Route path="/trips/:tripId" element={<TripLayout />}>
          <Route index element={<OverviewScreen />} />
          <Route path="stay" element={<StayMenuScreen />} />
          <Route path="transport" element={<TransportMenuScreen />} />
          <Route path="activities" element={<ActivitiesMenuScreen />} />
          <Route path="budget" element={<BudgetMenuScreen />} />
          <Route path="souvenirs" element={<SouvenirsMenuScreen />} />
        </Route>
        <Route path="/reservations/:reservationId" element={<ReservationDetailScreen />} />
        <Route path="/privacy" element={<PrivacyPolicyScreen />} />
      </Routes>
      <ReportWidget />
      <SavedToast />
      {showPasswordRecovery && <PasswordRecoveryModal onClose={() => setShowPasswordRecovery(false)} />}
    </APIProvider>
  )
}
