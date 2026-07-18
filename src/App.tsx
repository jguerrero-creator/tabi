import { Route, Routes } from 'react-router-dom'
import { TripLayout } from './components/menu/TripLayout'
import { ActivitiesMenuScreen } from './features/activities/ActivitiesMenuScreen'
import { ReservationDetailScreen } from './features/reservations/ReservationDetailScreen'
import { StayMenuScreen } from './features/stay/StayMenuScreen'
import { TransportMenuScreen } from './features/transport/TransportMenuScreen'
import { OverviewScreen } from './features/trips/OverviewScreen'
import { TripsListScreen } from './features/trips/TripsListScreen'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<TripsListScreen />} />
      <Route path="/trips/:tripId" element={<TripLayout />}>
        <Route index element={<OverviewScreen />} />
        <Route path="stay" element={<StayMenuScreen />} />
        <Route path="transport" element={<TransportMenuScreen />} />
        <Route path="activities" element={<ActivitiesMenuScreen />} />
      </Route>
      <Route path="/reservations/:reservationId" element={<ReservationDetailScreen />} />
    </Routes>
  )
}
