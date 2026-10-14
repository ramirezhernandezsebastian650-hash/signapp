import { PDFDocument } from 'pdf-lib'
import { createHash } from 'node:crypto'
import { admin } from './supabase.js'
import { enviarCorreo, esc } from './correo.js'

const sha256 = (datos: Uint8Array) => createHash('sha256').update(datos).digest('hex')

type Zona = { pagina: number; pos_x: number; pos_y: number; ancho: number; alto: number }
type Firma = { tipo: string; archivo_firma_path: string }
type SolicitudConFirma = { id: string; zonas_firma: Zona[]; firmas: Firma | Firma[] | null }

async function bajar(bucket: string, ruta: string) {
  const { data, error } = await admin.storage.from(bucket).download(ruta)
  if (error || !data) throw new Error(`No se pudo leer ${bucket}/${ruta}: ${error?.message}`)
  return new Uint8Array(await data.arrayBuffer())
}

async function generarPdfFinal(documentoId: string) {
  const { data: doc, error } = await admin
    .from('documentos')
    .select('id, nombre_archivo, propietario_id, storage_path, hash_original')
    .eq('id', documentoId)
    .single()
  if (error || !doc) throw new Error('Documento no encontrado.')

  const { data: sols, error: eSols } = await admin
    .from('solicitudes_firma')
    .select('id, zonas_firma(pagina, pos_x, pos_y, ancho, alto), firmas(tipo, archivo_firma_path)')
    .eq('documento_id', documentoId)
  if (eSols || !sols) throw new Error('No se pudieron leer las firmas.')

  // Integridad: el PDF original no debe haber cambiado desde que se subió
  const original = await bajar('documentos', doc.storage_path)
  if (doc.hash_original && sha256(original) !== doc.hash_original) {
    throw new Error('El PDF original no coincide con su hash. Se cancela la generación.')
  }

  const pdf = await PDFDocument.load(original)

  for (const s of sols as unknown as SolicitudConFirma[]) {
    const firma = Array.isArray(s.firmas) ? s.firmas[0] : s.firmas
    if (!firma) throw new Error(`Falta la firma de la solicitud ${s.id}.`)

    const bytes = await bajar('firmas', firma.archivo_firma_path)
    const imagen = firma.archivo_firma_path.endsWith('.png')
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes)
    const natural = imagen.scale(1)

    for (const z of s.zonas_firma) {
      const pagina = pdf.getPage(z.pagina - 1)
      const { width, height } = pagina.getSize()

      // Zona en puntos PDF (origen abajo-izquierda)
      const zx = z.pos_x * width
      const zw = z.ancho * width
      const zh = z.alto * height
      const zy = height - z.pos_y * height - zh

      // La firma se escala para caber dentro de la zona sin deformarse, centrada
      const factor = Math.min(zw / natural.width, zh / natural.height)
      const dw = natural.width * factor
      const dh = natural.height * factor
      pagina.drawImage(imagen, {
        x: zx + (zw - dw) / 2,
        y: zy + (zh - dh) / 2,
        width: dw,
        height: dh,
      })
    }
  }

  const final = await pdf.save()
  const hashFinal = sha256(final)
  const ruta = `${doc.propietario_id}/${doc.id}-firmado.pdf`

  const { error: eSubida } = await admin.storage
    .from('firmados')
    .upload(ruta, Buffer.from(final), { contentType: 'application/pdf', upsert: true })
  if (eSubida) throw new Error(eSubida.message)

  await admin.from('documentos')
    .update({ storage_path_final: ruta, hash_final: hashFinal })
    .eq('id', doc.id)
  await admin.from('auditoria').insert({ documento_id: doc.id, accion: 'documento_completado' })

  try {
    const { data: dueno } = await admin.from('profiles').select('correo').eq('id', doc.propietario_id).single()
    if (dueno) {
      const enlace = `${process.env.FRONTEND_URL}/`
      await enviarCorreo({
        para: dueno.correo,
        asunto: `Documento firmado por todos: ${doc.nombre_archivo}`,
        enlace,
        html: `<p>Todos los firmantes completaron <b>${esc(doc.nombre_archivo)}</b>.</p>
<p><a href="${enlace}">Abrir SignApp</a> para descargar el PDF firmado.</p>`,
      })
    }
  } catch (e) {
    console.error('No se pudo avisar al propietario:', e)
  }
}

// Si ya firmaron todos, genera el PDF final. Devuelve 'completo', 'pendientes' o 'error'.
export async function intentarFinalizar(documentoId: string): Promise<'completo' | 'pendientes' | 'error'> {
  const { count } = await admin
    .from('solicitudes_firma')
    .select('id', { count: 'exact', head: true })
    .eq('documento_id', documentoId)
    .neq('estado', 'firmado')
  if (count) return 'pendientes'

  // Solo un proceso puede reclamar la finalización
  const { data: reclamado } = await admin
    .from('documentos')
    .update({ estado: 'firmado' })
    .eq('id', documentoId)
    .eq('estado', 'en_proceso')
    .select('id')
  if (!reclamado?.length) return 'pendientes'

  try {
    await generarPdfFinal(documentoId)
    return 'completo'
  } catch (e) {
    console.error('Error generando el PDF final:', e)
    await admin.from('documentos').update({ estado: 'en_proceso' }).eq('id', documentoId)
    return 'error'
  }
}
