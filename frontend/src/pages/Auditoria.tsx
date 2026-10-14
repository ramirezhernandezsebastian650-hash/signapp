import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Evento = { id: string; accion: string; ip: string | null; fecha_hora: string }
type Doc = { nombre_archivo: string; estado: string; hash_original: string | null; hash_final: string | null }

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'medium' })

function descripcion(accion: string) {
  if (accion === 'envio') return 'Documento enviado a los firmantes'
  if (accion === 'documento_completado') return 'Todos firmaron: PDF final generado'
  if (accion.startsWith('apertura por ')) return `Enlace abierto por ${accion.slice(13)}`
  if (accion.startsWith('firma de ')) return `Firma de ${accion.slice(9)}`
  if (accion.startsWith('rechazo de ')) return `Rechazo de ${accion.slice(11)}`
  return accion
}

export default function Auditoria() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      const { data: d, error: e1 } = await supabase
        .from('documentos')
        .select('nombre_archivo, estado, hash_original, hash_final')
        .eq('id', id!)
        .single()
      if (e1 || !d) return setError('Documento no encontrado.')
      setDoc(d as Doc)

      const { data, error: e2 } = await supabase
        .from('auditoria')
        .select('id, accion, ip, fecha_hora')
        .eq('documento_id', id!)
        .order('fecha_hora', { ascending: true })
      if (e2) return setError(e2.message)
      setEventos((data as Evento[]) ?? [])
    })()
  }, [id])

  function exportarCsv() {
    const celda = (t: string) => `"${t.replace(/"/g, '""')}"`
    const filas = [
      ['Fecha', 'Evento', 'IP'],
      ...eventos.map((e) => [fecha(e.fecha_hora), descripcion(e.accion), e.ip ?? '']),
    ]
    const csv = '\ufeff' + filas.map((f) => f.map(celda).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `auditoria-${doc?.nombre_archivo ?? 'documento'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <div className="panel"><p className="mensaje">{error}</p><button onClick={() => navigate('/')}>Volver</button></div>
  if (!doc) return <div className="panel"><p>Cargando...</p></div>

  return (
    <div className="panel">
      <header>
        <h1>Historial: {doc.nombre_archivo}</h1>
        <button onClick={() => navigate('/')}>Volver</button>
      </header>

      <div className="integridad">
        <p><b>Estado:</b> {doc.estado}</p>
        <p><b>Hash del original (SHA-256):</b> <code>{doc.hash_original ?? 'no disponible'}</code></p>
        <p><b>Hash del PDF firmado (SHA-256):</b> <code>{doc.hash_final ?? 'aún no generado'}</code></p>
      </div>

      <div className="fila" style={{ margin: '16px 0' }}>
        <button onClick={exportarCsv} disabled={!eventos.length}>Exportar CSV</button>
      </div>

      {eventos.length === 0 ? (
        <p className="vacio">No hay eventos registrados para este documento.</p>
      ) : (
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Evento</th><th>IP</th></tr></thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <td>{fecha(e.fecha_hora)}</td>
                <td>{descripcion(e.accion)}</td>
                <td>{e.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
