import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Doc = {
  id: string
  nombre_archivo: string
  estado: string
  storage_path: string
  storage_path_final: string | null
  hash_original: string | null
  creado_en: string
}

async function sha256(file: File) {
  const buffer = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [nombre, setNombre] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')

  async function cargarDocs() {
    const { data } = await supabase
      .from('documentos')
      .select('id, nombre_archivo, estado, storage_path, storage_path_final, hash_original, creado_en')
      .order('creado_en', { ascending: false })
    setDocs((data as Doc[]) ?? [])
  }

  useEffect(() => {
    supabase.from('profiles').select('nombre').single()
      .then(({ data }) => { if (data) setNombre(data.nombre) })
    cargarDocs()
  }, [])

  async function subir(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setError('')

    if (archivo.type !== 'application/pdf') return setError('Solo se permiten archivos PDF.')
    if (archivo.size > 10 * 1024 * 1024) return setError('El archivo supera los 10 MB.')

    setSubiendo(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return setError('Sesión no válida.')

      const ruta = `${user.id}/${crypto.randomUUID()}.pdf`
      const hash = await sha256(archivo)

      const { error: errStorage } = await supabase.storage
        .from('documentos')
        .upload(ruta, archivo, { contentType: 'application/pdf' })
      if (errStorage) return setError(errStorage.message)

      const { error: errDb } = await supabase.from('documentos').insert({
        propietario_id: user.id,
        nombre_archivo: archivo.name,
        storage_path: ruta,
        hash_original: hash,
      })
      if (errDb) {
        await supabase.storage.from('documentos').remove([ruta])
        return setError(errDb.message)
      }
      await cargarDocs()
    } finally {
      setSubiendo(false)
    }
  }

  async function abrirFinal(path: string) {
    for (const bucket of ['firmados', 'documentos']) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
      if (data?.signedUrl) return void window.open(data.signedUrl, '_blank')
    }
    setError('No se pudo abrir el documento firmado.')
  }

  async function abrir(path: string) {
    const { data, error } = await supabase.storage
      .from('documentos')
      .createSignedUrl(path, 60)
    if (error) return setError(error.message)
    window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="panel">
      <header>
        <h1>Mis documentos</h1>
        <div>
          <span>Hola, {nombre || '...'}</span>{' '}
          <button onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </header>

      <label className="subir">
        {subiendo ? 'Subiendo...' : '+ Subir documento PDF'}
        <input type="file" accept="application/pdf" onChange={subir} disabled={subiendo} hidden />
      </label>

      {error && <p className="mensaje">{error}</p>}

      {docs.length === 0 ? (
        <p className="vacio">Aún no tienes documentos. Sube el primero.</p>
      ) : (
        <ul className="lista">
          {docs.map((d) => (
            <li key={d.id}>
              <div>
                <strong>{d.nombre_archivo}</strong>
                <small>SHA-256: {d.hash_original?.slice(0, 16)}…</small>
              </div>
              <span className={`estado ${d.estado}`}>{d.estado}</span>
              <button onClick={() => abrir(d.storage_path)}>Original</button>
              <button onClick={() => navigate(`/documento/${d.id}/auditoria`)}>Historial</button>
              {d.estado === 'borrador' && (
                <button onClick={() => navigate(`/documento/${d.id}/configurar`)}>Configurar firmantes</button>
              )}
              {d.estado === 'firmado' && d.storage_path_final && (
                <button onClick={() => abrirFinal(d.storage_path_final!)}>Firmado</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
