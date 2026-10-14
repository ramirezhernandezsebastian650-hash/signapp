import type { ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import FirmarPublico from './pages/FirmarPublico'
import ConfigurarFirmantes from './pages/ConfigurarFirmantes'

function Protegida({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <p>Cargando...</p>
  return session ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Auth />} />
          <Route path="/firmar/:token" element={<FirmarPublico />} />
          <Route path="/" element={<Protegida><Dashboard /></Protegida>} />
          <Route path="/documento/:id/configurar" element={<Protegida><ConfigurarFirmantes /></Protegida>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
