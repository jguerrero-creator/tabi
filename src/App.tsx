import { Route, Routes } from 'react-router-dom'
import { ReservationDetailScreen } from './features/reservations/ReservationDetailScreen'
import { TripsListScreen } from './features/trips/TripsListScreen'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<TripsListScreen />} />
      <Route path="/reservations/:reservationId" element={<ReservationDetailScreen />} />
    </Routes>
  )
}
