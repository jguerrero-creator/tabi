import { Route, Routes } from 'react-router-dom'
import { ReservationDetailScreen } from './features/reservations/ReservationDetailScreen'
import { StayMenuScreen } from './features/stay/StayMenuScreen'
import { TripsListScreen } from './features/trips/TripsListScreen'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<TripsListScreen />} />
      <Route path="/trips/:tripId/stay" element={<StayMenuScreen />} />
      <Route path="/reservations/:reservationId" element={<ReservationDetailScreen />} />
    </Routes>
  )
}
