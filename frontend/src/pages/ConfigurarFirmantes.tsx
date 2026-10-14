import { useEffect, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { supabase } from '../lib/supabase'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const ANCHO = 600
const COLORES = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2']

type Zona = { id: string; pagina: number; pos_x: number; pos_y: number; ancho: number; alto: number }
type Firmante = { id: string; firmante_correo: string; orden_firma: number; estado: string; zonas_firma: Zona[] }
type Doc = { id: string; nombre_archivo: string; estado: string; storage_path: string }
type Arrastre = { x0: number; y0: number; x1: number; y1: number }

export default function ConfigurarFirmantes() {
  const { id } = useParams()
  const navigate = useNavigate()
  const overlayRef = useRef<HTMLDivElement>(null)

  const [doc, setDoc] = useState<Doc | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [numPaginas, setNumPaginas] = useState(1)
  const [pagina, setPagina] = useState(1)
  const [firmantes, setFirmantes] = useState<Firmante[]>([])
  const [activo, setActivo] = useState<string | null>(null)
  const [correo, setCorreo] = useState('')
  const [arrastre, setArrastre] = useState<Arrastre | null>(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data, error: e1 } = await supabase
        .from('documentos')
        .select('id, nombre_archivo, estado, storage_path')
        .eq('id', id!)
        .single()
      if (e1 || !data) return setError('Documento no encontrado.')
      setDoc(data as Doc)
      if (data.estado !== 'borrador') return

      const { data: blob, error: e2 } = await supabase.storage.from('documentos').download(data.storage_path)
      if (e2 || !blob) return setError('No se pudo descargar el PDF.')
      setPdfBlob(blob)

      const { data: sols, error: e3 } = await supabase
        .from('solicitudes_firma')
        .select('id, firmante_correo, orden_firma, estado, zonas_firma(id, pagina, pos_x, pos_y, ancho, alto)')
        .eq('documento_id', data.id)
        .order('orden_firma')
      if (e3) return setError(e3.message)
      const lista = (sols as Firmante[]) ?? []
      setFirmantes(lista)
      if (lista.length) setActivo(lista[0].id)
    })()
  }, [id])

  async function agregarFirmante(e: FormEvent) {
    e.preventDefault()
    if (!doc) return
    setError('')
    const { data, error: err } = await supabase
      .from('solicitudes_firma')
      .insert({
        documento_id: doc.id,
        firmante_correo: correo.trim().toLowerCase(),
        orden_firma: firmantes.length + 1,
      })
      .select('id, firmante_correo, orden_firma, estado')
      .single()
    if (err || !data) {
      return setError(err?.code === '23505' ? 'Ese correo ya está en la lista.' : (err?.message ?? 'Error'))
    }
    setFirmantes([...firmantes, { ...(data as Omit<Firmante, 'zonas_firma'>), zonas_firma: [] }])
    if (!activo) setActivo(data.id)
    setCorreo('')
  }

  async function quitarFirmante(f: Firmante) {
    const { error: err } = await supabase.from('solicitudes_firma').delete().eq('id', f.id)
    if (err) return setError(err.message)
    const resto = firmantes.filter((x) => x.id !== f.id)
    setFirmantes(resto)
    if (activo === f.id) setActivo(resto[0]?.id ?? null)
  }

  async function borrarZona(f: Firmante, z: Zona) {
    const { error: err } = await supabase.from('zonas_firma').delete().eq('id', z.id)
    if (err) return setError(err.message)
    setFirmantes(firmantes.map((x) =>
      x.id === f.id ? { ...x, zonas_firma: x.zonas_firma.filter((y) => y.id !== z.id) } : x
    ))
  }

  function punto(e: RPointerEvent<HTMLDivElement>) {
    const r = overlayRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  function iniciar(e: RPointerEvent<HTMLDivElement>) {
    if (!activo) return setError('Agrega y selecciona un firmante primero.')
    setError('')
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = punto(e)
    setArrastre({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }

  function mover(e: RPointerEvent<HTMLDivElement>) {
    if (!arrastre) return
    const p = punto(e)
    setArrastre({ ...arrastre, x1: p.x, y1: p.y })
  }

  async function terminar() {
    if (!arrastre || !activo) return
    const zona = {
      pos_x: Math.min(arrastre.x0, arrastre.x1),
      pos_y: Math.min(arrastre.y0, arrastre.y1),
      ancho: Math.abs(arrastre.x1 - arrastre.x0),
      alto: Math.abs(arrastre.y1 - arrastre.y0),
    }
    setArrastre(null)
    if (zona.ancho < 0.05 || zona.alto < 0.02) return setError('La zona es muy pequeña. Arrastra un rectángulo más grande.')

    const { data, error: err } = await supabase
      .from('zonas_firma')
      .insert({ solicitud_id: activo, pagina, ...zona })
      .select('id, pagina, pos_x, pos_y, ancho, alto')
      .single()
    if (err || !data) return setError(err?.message ?? 'No se pudo guardar la zona.')
    setFirmantes(firmantes.map((f) =>
      f.id === activo ? { ...f, zonas_firma: [...f.zonas_firma, data as Zona] } : f
    ))
  }

  async function enviar() {
    setError('')
    setEnviando(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/documentos/${doc!.id}/enviar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const cuerpo = await resp.json().catch(() => ({}))
      if (!resp.ok) return setError(cuerpo.error ?? 'No se pudo enviar el documento.')
      if (cuerpo.fallidos?.length) alert('No se pudo enviar el correo a: ' + cuerpo.fallidos.join(', '))
      navigate('/')
    } catch {
      setError('No se pudo conectar con el servidor. ¿Está corriendo el backend?')
    } finally {
      setEnviando(false)
    }
  }

  if (error && !doc) return <div className="panel"><p className="mensaje">{error}</p></div>
  if (!doc) return <div className="panel"><p>Cargando documento...</p></div>
  if (doc.estado !== 'borrador') {
    return (
      <div className="panel">
        <p>Este documento ya fue enviado. Las zonas de firma no se pueden modificar.</p>
        <button onClick={() => navigate('/')}>Volver</button>
      </div>
    )
  }
  if (!pdfBlob) return <div className="panel"><p>Cargando PDF...</p></div>

  const listo = firmantes.length > 0 && firmantes.every((f) => f.zonas_firma.length > 0)
  const rect = arrastre && {
    left: Math.min(arrastre.x0, arrastre.x1) * 100,
    top: Math.min(arrastre.y0, arrastre.y1) * 100,
    width: Math.abs(arrastre.x1 - arrastre.x0) * 100,
    height: Math.abs(arrastre.y1 - arrastre.y0) * 100,
  }
  const colorActivo = COLORES[Math.max(0, firmantes.findIndex((f) => f.id === activo)) % COLORES.length]

  return (
    <div className="panel ancho">
      <header>
        <h1>Configurar firmantes: {doc.nombre_archivo}</h1>
        <button onClick={() => navigate('/')}>Volver</button>
      </header>

      <div className="firma-layout">
        <div>
          <div className="pdf-wrap" style={{ position: 'relative', width: ANCHO }}>
            <Document file={pdfBlob} onLoadSuccess={({ numPages }) => setNumPaginas(numPages)}>
              <Page pageNumber={pagina} width={ANCHO} />
            </Document>

            <div
              ref={overlayRef}
              className="overlay"
              onPointerDown={iniciar}
              onPointerMove={mover}
              onPointerUp={terminar}
            >
              {firmantes.map((f, i) =>
                f.zonas_firma.filter((z) => z.pagina === pagina).map((z) => (
                  <div
                    key={z.id}
                    className="zona"
                    style={{
                      left: `${z.pos_x * 100}%`, top: `${z.pos_y * 100}%`,
                      width: `${z.ancho * 100}%`, height: `${z.alto * 100}%`,
                      borderColor: COLORES[i % COLORES.length],
                      background: COLORES[i % COLORES.length] + '33',
                    }}
                  >
                    <span style={{ background: COLORES[i % COLORES.length] }}>{f.firmante_correo}</span>
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => borrarZona(f, z)}
                    >×</button>
                  </div>
                ))
              )}
              {rect && (
                <div
                  className="zona"
                  style={{
                    left: `${rect.left}%`, top: `${rect.top}%`,
                    width: `${rect.width}%`, height: `${rect.height}%`,
                    borderColor: colorActivo, background: colorActivo + '33',
                  }}
                />
              )}
            </div>
          </div>

          <div className="paginas">
            <button disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>←</button>
            <span>Página {pagina} de {numPaginas}</span>
            <button disabled={pagina >= numPaginas} onClick={() => setPagina(pagina + 1)}>→</button>
          </div>
        </div>

        <aside className="lateral">
          <h3>Firmantes</h3>
          <form onSubmit={agregarFirmante} className="fila">
            <input type="email" placeholder="correo@ejemplo.com" value={correo}
                   onChange={(e) => setCorreo(e.target.value)} required />
            <button type="submit">Añadir</button>
          </form>

          <ul className="firmantes">
            {firmantes.map((f, i) => (
              <li key={f.id}
                  className={f.id === activo ? 'sel' : ''}
                  style={{ borderLeftColor: COLORES[i % COLORES.length] }}
                  onClick={() => setActivo(f.id)}>
                <div>
                  <strong>{f.firmante_correo}</strong>
                  <small>{f.zonas_firma.length} zona(s)</small>
                </div>
                <button onClick={(e) => { e.stopPropagation(); quitarFirmante(f) }}>Quitar</button>
              </li>
            ))}
          </ul>

          <p className="ayuda">
            Selecciona un firmante y arrastra sobre el documento para marcar dónde firmará.
            Puedes marcar varias zonas y cambiar de página.
          </p>
          {error && <p className="mensaje">{error}</p>}

          <button className="confirmar" disabled={!listo || enviando} onClick={enviar}>
            {enviando ? 'Enviando...' : 'Enviar para firma'}
          </button>
          <p className="ayuda">
            {listo
              ? 'Todo listo. Al enviar, las zonas quedan bloqueadas y cada firmante recibe su enlace.'
              : 'Cada firmante necesita al menos una zona antes de poder enviar.'}
          </p>
        </aside>
      </div>
    </div>
  )
}
