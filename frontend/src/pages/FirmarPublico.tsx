import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import SignatureCanvas from 'react-signature-canvas'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const API = import.meta.env.VITE_API_URL
const ANCHO = 600

type Zona = { pagina: number; pos_x: number; pos_y: number; ancho: number; alto: number }
type Info = {
  nombreDocumento: string
  firmanteCorreo: string
  estadoSolicitud: string
  estadoDocumento: string
  puedeFirmar: boolean
  zonas: Zona[]
}

export default function FirmarPublico() {
  const { token } = useParams()
  const sigRef = useRef<SignatureCanvas>(null)
  const base = `${API}/api/firmar/${token}`

  const [info, setInfo] = useState<Info | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [numPaginas, setNumPaginas] = useState(1)
  const [pagina, setPagina] = useState(1)
  const [modo, setModo] = useState<'dibujar' | 'imagen'>('dibujar')
  const [firmaUrl, setFirmaUrl] = useState<string | null>(null)
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [final, setFinal] = useState<null | { tipo: 'firmado' | 'rechazado'; completo?: boolean }>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch(base)
        const datos = await r.json().catch(() => ({}))
        if (!r.ok) return setError(datos.error ?? 'Enlace no válido.')
        setInfo(datos as Info)
        if (!datos.puedeFirmar) return
        if (datos.zonas.length) setPagina(datos.zonas[0].pagina)
        const rp = await fetch(`${base}/pdf`)
        if (!rp.ok) return setError('No se pudo cargar el documento.')
        setPdfBlob(await rp.blob())
      } catch {
        setError('No se pudo conectar con el servidor.')
      }
    })()
  }, [base])

  function usarDibujo() {
    if (!sigRef.current || sigRef.current.isEmpty()) return setError('Dibuja tu firma primero.')
    setError('')
    setFirmaUrl(sigRef.current.getCanvas().toDataURL('image/png'))
  }

  function cargarImagen(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    if (!['image/png', 'image/jpeg'].includes(archivo.type)) return setError('Solo PNG o JPG.')
    if (archivo.size > 2 * 1024 * 1024) return setError('La imagen supera los 2 MB.')
    setError('')
    const lector = new FileReader()
    lector.onload = () => setFirmaUrl(lector.result as string)
    lector.readAsDataURL(archivo)
  }

  async function enviarAccion(ruta: string, cuerpo: object) {
    setError('')
    setEnviando(true)
    try {
      const r = await fetch(`${base}/${ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const datos = await r.json().catch(() => ({}))
      if (!r.ok) return setError(datos.error ?? 'No se pudo completar la acción.')
      return datos
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setEnviando(false)
    }
  }

  async function confirmar() {
    if (!firmaUrl) return
    const datos = await enviarAccion('firmar', {
      tipo: modo === 'dibujar' ? 'dibujada' : 'imagen',
      imagen: firmaUrl,
    })
    if (datos?.ok) setFinal({ tipo: 'firmado', completo: datos.completo })
  }

  async function rechazar() {
    const datos = await enviarAccion('rechazar', { motivo })
    if (datos?.ok) setFinal({ tipo: 'rechazado' })
  }

  if (error && !info) return <div className="card"><h1>SignApp</h1><p className="mensaje">{error}</p></div>
  if (!info) return <div className="card"><p>Cargando...</p></div>

  if (final) {
    return (
      <div className="card">
        <h1>SignApp</h1>
        {final.tipo === 'firmado' ? (
          <>
            <p><b>Firma registrada. ¡Gracias!</b></p>
            <p className="sub">
              {final.completo
                ? 'Todos los firmantes ya firmaron. El propietario recibirá el documento final.'
                : 'Cuando los demás firmantes terminen, el propietario recibirá el documento final.'}
            </p>
          </>
        ) : (
          <p><b>Rechazaste el documento.</b> El propietario fue notificado con tu motivo.</p>
        )}
      </div>
    )
  }

  if (!info.puedeFirmar) {
    let mensaje = 'Este documento ya no está disponible para firma.'
    if (info.estadoSolicitud === 'firmado') mensaje = 'Ya firmaste este documento.'
    else if (info.estadoSolicitud === 'rechazado') mensaje = 'Rechazaste este documento.'
    else if (info.estadoDocumento === 'rechazado') mensaje = 'Este documento fue rechazado y ya no admite firmas.'
    else if (info.estadoDocumento === 'firmado') mensaje = 'Este documento ya fue firmado por todos.'
    return <div className="card"><h1>SignApp</h1><p>{mensaje}</p></div>
  }

  if (!pdfBlob) return <div className="card"><p>Cargando documento...</p></div>

  const paginasZona = [...new Set(info.zonas.map((z) => z.pagina))].join(', ')

  return (
    <div className="panel ancho">
      <header>
        <h1>Firmar: {info.nombreDocumento}</h1>
        <span>Firmas como {info.firmanteCorreo}</span>
      </header>

      <div className="firma-layout">
        <div>
          <div className="pdf-wrap" style={{ position: 'relative', width: ANCHO }}>
            <Document file={pdfBlob} onLoadSuccess={({ numPages }) => setNumPaginas(numPages)}>
              <Page pageNumber={pagina} width={ANCHO} />
            </Document>
            <div className="overlay-ro">
              {info.zonas.filter((z) => z.pagina === pagina).map((z, i) => (
                <div
                  key={i}
                  className="zona-firma"
                  style={{
                    left: `${z.pos_x * 100}%`, top: `${z.pos_y * 100}%`,
                    width: `${z.ancho * 100}%`, height: `${z.alto * 100}%`,
                  }}
                >
                  {firmaUrl ? <img src={firmaUrl} alt="Tu firma" /> : <span>Tu firma aquí</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="paginas">
            <button disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>←</button>
            <span>Página {pagina} de {numPaginas}</span>
            <button disabled={pagina >= numPaginas} onClick={() => setPagina(pagina + 1)}>→</button>
          </div>
        </div>

        <aside className="lateral">
          <p className="ayuda">
            El remitente definió {info.zonas.length} zona(s) para tu firma, en la(s) página(s) {paginasZona}.
            Tu firma se colocará solo ahí.
          </p>

          <h3>Tu firma</h3>
          <div className="tabs">
            <button className={modo === 'dibujar' ? 'activa' : ''} onClick={() => setModo('dibujar')}>Dibujar</button>
            <button className={modo === 'imagen' ? 'activa' : ''} onClick={() => setModo('imagen')}>Subir imagen</button>
          </div>

          {modo === 'dibujar' ? (
            <>
              <SignatureCanvas
                ref={sigRef}
                penColor="#0f172a"
                canvasProps={{ width: 280, height: 140, className: 'lienzo' }}
              />
              <div className="fila">
                <button onClick={() => sigRef.current?.clear()}>Borrar</button>
                <button onClick={usarDibujo}>Usar esta firma</button>
              </div>
            </>
          ) : (
            <label className="subir">
              Elegir PNG o JPG
              <input type="file" accept="image/png,image/jpeg" onChange={cargarImagen} hidden />
            </label>
          )}

          {error && <p className="mensaje">{error}</p>}

          <button className="confirmar" disabled={!firmaUrl || enviando} onClick={confirmar}>
            {enviando ? 'Enviando...' : 'Confirmar firma'}
          </button>

          {!rechazando ? (
            <button className="rechazar" onClick={() => setRechazando(true)}>Rechazar documento</button>
          ) : (
            <div className="rechazo">
              <textarea
                placeholder="Motivo del rechazo (obligatorio)"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
              />
              <div className="fila">
                <button onClick={() => setRechazando(false)}>Cancelar</button>
                <button className="rechazar" disabled={motivo.trim().length < 3 || enviando} onClick={rechazar}>
                  Confirmar rechazo
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
