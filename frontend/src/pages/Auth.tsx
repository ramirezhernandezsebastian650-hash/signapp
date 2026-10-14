import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const [modo, setModo] = useState<'login' | 'registro'>('login')
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [cargando, setCargando] = useState(false)
  const navigate = useNavigate()

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setCargando(true)
    setMensaje('')

    if (modo === 'registro') {
      const { data, error } = await supabase.auth.signUp({
        email: correo,
        password,
        options: { data: { nombre } },
      })
      if (error) setMensaje(error.message)
      else if (!data.session) setMensaje('Revisa tu correo para confirmar la cuenta.')
      else navigate('/')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: correo, password })
      if (error) setMensaje(error.message)
      else navigate('/')
    }
    setCargando(false)
  }

  return (
    <div className="card">
      <h1>SignApp</h1>
      <p className="sub">{modo === 'login' ? 'Inicia sesión' : 'Crea tu cuenta'}</p>

      <form onSubmit={enviar}>
        {modo === 'registro' && (
          <input placeholder="Nombre completo" value={nombre}
                 onChange={(e) => setNombre(e.target.value)} required />
        )}
        <input type="email" placeholder="Correo electrónico" value={correo}
               onChange={(e) => setCorreo(e.target.value)} required />
        <input type="password" placeholder="Contraseña (mínimo 6 caracteres)" value={password}
               onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        <button type="submit" disabled={cargando}>
          {cargando ? 'Procesando...' : modo === 'login' ? 'Iniciar sesión' : 'Registrarme'}
        </button>
      </form>

      {mensaje && <p className="mensaje">{mensaje}</p>}

      <p className="cambio">
        {modo === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
        <a href="#" onClick={(e) => { e.preventDefault(); setMensaje(''); setModo(modo === 'login' ? 'registro' : 'login') }}>
          {modo === 'login' ? 'Regístrate' : 'Inicia sesión'}
        </a>
      </p>
    </div>
  )
}
