import { Route, Routes } from 'react-router-dom'
import { TripsListScreen } from './features/trips/TripsListScreen'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<TripsListScreen />} />
    </Routes>
  )
}
