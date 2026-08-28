import { APIProvider } from '@vis.gl/react-google-maps'
import { Route, Routes } from 'react-router-dom'
import { TripLayout } from './components/menu/TripLayout'
import { ReportWidget } from './components/ui/ReportWidget'
import { SavedToast } from './components/ui/SavedToast'
import { ActivitiesMenuScreen } from './features/activities/ActivitiesMenuScreen'
import { BudgetCategoryDetailScreen } from './features/budget/BudgetCategoryDetailScreen'
import { BudgetMenuScreen } from './features/budget/BudgetMenuScreen'
import { PrivacyPolicyScreen } from './features/legal/PrivacyPolicyScreen'
import { ReservationDetailScreen } from './features/reservations/ReservationDetailScreen'
import { SouvenirsMenuScreen } from './features/souvenirs/SouvenirsMenuScreen'
import { StayMenuScreen } from './features/stay/StayMenuScreen'
import { TransportMenuScreen } from './features/transport/TransportMenuScreen'
import { OverviewScreen } from './features/trips/OverviewScreen'
import { TripsListScreen } from './features/trips/TripsListScreen'
import { MAPS_LIBRARIES, mapsApiKey } from './lib/googleMaps'

// Single Maps JS API load for the whole app lifecycle (never unmounted, unlike the
// per-screen/per-modal APIProviders this replaced — those mounted and unmounted on
// every navigation and every Add-sheet open, each with its own libraries array,
// which made the Maps loader think its parameters kept changing and spammed
// "already been loaded with different parameters" on nearly every action).
export function App() {
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
          <Route path="budget/:type" element={<BudgetCategoryDetailScreen />} />
          <Route path="souvenirs" element={<SouvenirsMenuScreen />} />
        </Route>
        <Route path="/reservations/:reservationId" element={<ReservationDetailScreen />} />
        <Route path="/privacy" element={<PrivacyPolicyScreen />} />
      </Routes>
      <ReportWidget />
      <SavedToast />
    </APIProvider>
  )
}
