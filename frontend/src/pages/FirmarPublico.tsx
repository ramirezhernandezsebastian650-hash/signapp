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
type Firmante = { firmante_correo: string; estado: string }
type Info = {
  nombreDocumento: string
  firmanteCorreo: string
  estadoSolicitud: string
  estadoDocumento: string
  puedeFirmar: boolean
  zonas: Zona[]
  firmantes: Firmante[]
  documentoFinal: boolean
}

function mensajeEstado(info: Info) {
  if (info.estadoDocumento === 'firmado') return 'Este documento ya fue firmado por todos. Estás viendo la copia final.'
  if (info.estadoDocumento === 'rechazado') return 'Este documento fue rechazado y ya no admite firmas.'
  if (info.estadoDocumento === 'cancelado') return 'El remitente canceló este documento.'
  if (info.estadoSolicitud === 'firmado') return 'Ya firmaste. Estás viendo el documento con las firmas registradas hasta ahora.'
  if (info.estadoSolicitud === 'rechazado') return 'Rechazaste este documento.'
  return 'Este documento ya no está disponible para firma.'
}

export default function FirmarPublico() {
  const { token } = useParams()
  const sigRef = useRef<SignatureCanvas>(null)
  const base = `${API}/api/firmar/${token}`

  const [info, setInfo] = useState<Info | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [version, setVersion] = useState(0)
  const [numPaginas, setNumPaginas] = useState(1)
  const [pagina, setPagina] = useState(1)
  const [modo, setModo] = useState<'dibujar' | 'imagen'>('dibujar')
  const [firmaUrl, setFirmaUrl] = useState<string | null>(null)
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch(base)
        const datos = await r.json().catch(() => ({}))
        if (!r.ok) return setError(datos.error ?? 'Enlace no válido.')
        setInfo(datos as Info)
        if (datos.puedeFirmar && datos.zonas.length) setPagina(datos.zonas[0].pagina)
        const rp = await fetch(`${base}/pdf`)
        if (!rp.ok) return setError('No se pudo cargar el documento.')
        setPdfBlob(await rp.blob())
      } catch {
        setError('No se pudo conectar con el servidor.')
      }
    })()
  }, [base, version])

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
    if (datos?.ok) {
      setAviso(
        datos.completo
          ? 'Firma registrada. Todos firmaron: recibirás la copia final por correo.'
          : 'Firma registrada. Puedes volver a abrir este enlace cuando quieras para revisar el documento.'
      )
      setFirmaUrl(null)
      setVersion((v) => v + 1)
    }
  }

  async function rechazar() {
    const datos = await enviarAccion('rechazar', { motivo })
    if (datos?.ok) {
      setAviso('Rechazaste el documento. El remitente fue notificado con tu motivo.')
      setRechazando(false)
      setMotivo('')
      setVersion((v) => v + 1)
    }
  }

  function descargar() {
    if (!pdfBlob || !info) return
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${info.documentoFinal ? 'firmado' : 'vista-previa'}-${info.nombreDocumento}`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error && !info) return <div className="card"><h1>SignApp</h1><p className="mensaje">{error}</p></div>
  if (!info) return <div className="card"><p>Cargando...</p></div>
  if (!pdfBlob) return <div className="card"><p>Cargando documento...</p></div>

  const paginasZona = [...new Set(info.zonas.map((z) => z.pagina))].join(', ')

  return (
    <div className="panel ancho">
      <header>
        <h1>{info.puedeFirmar ? 'Firmar' : 'Documento'}: {info.nombreDocumento}</h1>
        <span>Entras como {info.firmanteCorreo}</span>
      </header>

      {aviso && <p className="aviso">{aviso}</p>}

      <div className="firma-layout">
        <div>
          <div className="pdf-wrap" style={{ position: 'relative', width: ANCHO }}>
            <Document file={pdfBlob} onLoadSuccess={({ numPages }) => setNumPaginas(numPages)}>
              <Page pageNumber={pagina} width={ANCHO} />
            </Document>
            {info.puedeFirmar && (
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
            )}
          </div>
          <div className="paginas">
            <button disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>←</button>
            <span>Página {pagina} de {numPaginas}</span>
            <button disabled={pagina >= numPaginas} onClick={() => setPagina(pagina + 1)}>→</button>
          </div>
        </div>

        <aside className="lateral">
          <h3>Firmantes</h3>
          <p className="chips">
            {info.firmantes.map((f, i) => (
              <span key={i} className={`chip ${f.estado}`}>
                {f.firmante_correo}{f.firmante_correo === info.firmanteCorreo ? ' (tú)' : ''} · {f.estado}
              </span>
            ))}
          </p>

          {info.puedeFirmar ? (
            <>
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
            </>
          ) : (
            <>
              <p className="ayuda">{mensajeEstado(info)}</p>
              <div className="fila">
                <button onClick={() => setVersion((v) => v + 1)}>Actualizar</button>
                <button onClick={descargar}>Descargar PDF</button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
