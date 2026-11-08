import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Firmante = {
  id: string
  firmante_correo: string
  estado: string
  motivo_rechazo: string | null
}

type Doc = {
  id: string
  nombre_archivo: string
  estado: string
  storage_path: string
  storage_path_final: string | null
  hash_original: string | null
  creado_en: string
  solicitudes_firma: Firmante[]
}

const ETIQUETAS: Record<string, string> = {
  borrador: 'Borrador',
  en_proceso: 'En proceso',
  firmado: 'Firmado',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
  pendiente: 'Pendiente',
}
const etiqueta = (estado: string) => ETIQUETAS[estado] ?? estado

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
    const { data, error: err } = await supabase
      .from('documentos')
      .select(
        'id, nombre_archivo, estado, storage_path, storage_path_final, hash_original, creado_en, ' +
        'solicitudes_firma(id, firmante_correo, estado, motivo_rechazo)'
      )
      .order('creado_en', { ascending: false })
      .order('orden_firma', { referencedTable: 'solicitudes_firma' })
    if (err) return setError(err.message)
    setDocs((data as unknown as Doc[]) ?? [])
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

  async function abrir(path: string) {
    const { data, error: err } = await supabase.storage.from('documentos').createSignedUrl(path, 60)
    if (err) return setError(err.message)
    window.open(data.signedUrl, '_blank')
  }

  async function abrirFinal(path: string) {
    for (const bucket of ['firmados', 'documentos']) {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
      if (data?.signedUrl) return void window.open(data.signedUrl, '_blank')
    }
    setError('No se pudo abrir el documento firmado.')
  }

  return (
    <div className="panel">
      <header>
        <div className="titulo-con-mascota">
          <img className="mascota-chica" src="/mascotas/patito.svg" alt="" />
          <div>
            <h1>Mis documentos</h1>
            <p className="saludo">Hola, {nombre || '...'} 👋</p>
          </div>
        </div>
        <button onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </header>

      <div className="barra-acciones">
        <label className="subir">
          {subiendo ? 'Subiendo...' : '+ Subir documento PDF'}
          <input type="file" accept="application/pdf" onChange={subir} disabled={subiendo} hidden />
        </label>
        <button onClick={cargarDocs}>Actualizar</button>
      </div>

      {error && <p className="mensaje">{error}</p>}

      {docs.length === 0 ? (
        <div className="vacio">
          <img className="mascota-grande" src="/mascotas/gatito.svg" alt="" />
          <p><b>Aún no tienes documentos</b></p>
          <p>Sube el primero y empezamos.</p>
        </div>
      ) : (
        <ul className="lista">
          {docs.map((d) => {
            const firmantes = d.solicitudes_firma ?? []
            const firmaron = firmantes.filter((f) => f.estado === 'firmado').length
            const rechazos = firmantes.filter((f) => f.estado === 'rechazado')
            return (
              <li key={d.id} className="doc-card">
                <div className="doc-top">
                  <div className="doc-info">
                    <h3 className="doc-nombre">{d.nombre_archivo}</h3>
                    <small className="doc-hash">SHA-256 {d.hash_original?.slice(0, 16)}…</small>
                  </div>
                  <span className={`estado ${d.estado}`}>{etiqueta(d.estado)}</span>
                </div>

                {firmantes.length > 0 && (
                  <div className="doc-seccion">
                    <div className="doc-seccion-titulo">
                      <span>Firmantes</span>
                      <span>{firmaron} de {firmantes.length} firmaron</span>
                    </div>
                    <div className="progreso">
                      <div className="progreso-barra" style={{ width: `${(firmaron / firmantes.length) * 100}%` }} />
                    </div>
                    <p className="chips">
                      {firmantes.map((f) => (
                        <span key={f.id} className={`chip ${f.estado}`}>
                          {f.firmante_correo} · {etiqueta(f.estado)}
                        </span>
                      ))}
                    </p>
                  </div>
                )}

                {rechazos.length > 0 && (
                  <div className="doc-motivo">
                    <p className="doc-motivo-titulo">Motivo del rechazo</p>
                    {rechazos.map((f) => (
                      <div key={f.id} className="doc-motivo-item">
                        <span className="doc-motivo-quien">{f.firmante_correo}</span>
                        <p className="doc-motivo-texto">“{f.motivo_rechazo}”</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="doc-acciones">
                  <button onClick={() => abrir(d.storage_path)}>Ver original</button>
                  <button onClick={() => navigate(`/documento/${d.id}/auditoria`)}>Historial</button>
                  {d.estado === 'borrador' && (
                    <button className="primario" onClick={() => navigate(`/documento/${d.id}/configurar`)}>
                      Configurar firmantes
                    </button>
                  )}
                  {d.estado === 'firmado' && d.storage_path_final && (
                    <button className="primario" onClick={() => abrirFinal(d.storage_path_final!)}>
                      Ver firmado
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
