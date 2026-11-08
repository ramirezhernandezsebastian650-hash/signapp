import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createHash } from 'node:crypto'
import { admin } from './supabase.js'
import { enviarCorreo, esc, plantilla } from './correo.js'

const sha256 = (datos: Uint8Array) => createHash('sha256').update(datos).digest('hex')

type Zona = { pagina: number; pos_x: number; pos_y: number; ancho: number; alto: number }
type Firma = { tipo: string; archivo_firma_path: string }
type SolicitudConFirma = {
  id: string
  firmante_correo: string
  zonas_firma: Zona[]
  firmas: Firma | Firma[] | null
}
type DocBasico = { id: string; nombre_archivo: string; propietario_id: string }

async function bajar(bucket: string, ruta: string) {
  const { data, error } = await admin.storage.from(bucket).download(ruta)
  if (error || !data) throw new Error(`No se pudo leer ${bucket}/${ruta}: ${error?.message}`)
  return new Uint8Array(await data.arrayBuffer())
}

// Arma el PDF con las firmas registradas.
// completo = true exige todas las firmas; completo = false genera una vista previa.
async function armarPdf(documentoId: string, completo: boolean) {
  const { data: doc, error } = await admin
    .from('documentos')
    .select('id, nombre_archivo, propietario_id, storage_path, hash_original')
    .eq('id', documentoId)
    .single()
  if (error || !doc) throw new Error('Documento no encontrado.')

  const { data: sols, error: eSols } = await admin
    .from('solicitudes_firma')
    .select('id, firmante_correo, zonas_firma(pagina, pos_x, pos_y, ancho, alto), firmas(tipo, archivo_firma_path)')
    .eq('documento_id', documentoId)
  if (eSols || !sols) throw new Error('No se pudieron leer las firmas.')

  // Integridad: el PDF original no debe haber cambiado desde que se subió
  const original = await bajar('documentos', doc.storage_path)
  if (doc.hash_original && sha256(original) !== doc.hash_original) {
    throw new Error('El PDF original no coincide con su hash. Se cancela la generación.')
  }

  const pdf = await PDFDocument.load(original)
  const lista = sols as unknown as SolicitudConFirma[]
  let faltan = 0

  for (const s of lista) {
    const firma = Array.isArray(s.firmas) ? s.firmas[0] : s.firmas
    if (!firma) {
      if (completo) throw new Error(`Falta la firma de la solicitud ${s.id}.`)
      faltan++
      continue
    }

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

  // La vista previa se marca para que nadie la confunda con el documento final
  if (!completo && faltan > 0) {
    const fuente = await pdf.embedFont(StandardFonts.Helvetica)
    const primera = pdf.getPage(0)
    primera.drawText(`VISTA PREVIA - faltan ${faltan} firma(s)`, {
      x: 12,
      y: primera.getSize().height - 14,
      size: 8,
      font: fuente,
      color: rgb(0.7, 0.1, 0.1),
    })
  }

  return {
    bytes: await pdf.save(),
    doc: doc as unknown as DocBasico,
    correos: lista.map((s) => s.firmante_correo),
  }
}

// Documento con las firmas registradas hasta ahora (para que los firmantes lo revisen)
export async function pdfVistaPrevia(documentoId: string) {
  const { bytes } = await armarPdf(documentoId, false)
  return bytes
}

// Envía el PDF firmado como adjunto al propietario y a cada firmante
async function enviarCopiaFinal(doc: DocBasico, correosFirmantes: string[], final: Uint8Array, hashFinal: string) {
  const { data: dueno } = await admin.from('profiles').select('correo').eq('id', doc.propietario_id).single()
  const adjunto = { filename: `firmado-${doc.nombre_archivo}`, content: Buffer.from(final) }
  const destinos = new Set<string>(correosFirmantes)
  if (dueno) destinos.add(dueno.correo)

  for (const para of destinos) {
    const esDueno = para === dueno?.correo
    const url = `${process.env.FRONTEND_URL}/`
    try {
      await enviarCorreo({
        para,
        asunto: `Documento firmado por todos: ${doc.nombre_archivo}`,
        adjuntos: [adjunto],
        enlace: esDueno ? url : undefined,
        html: plantilla({
          titulo: 'Documento firmado por todos',
          parrafos: [
            `Todos los firmantes completaron <b>${esc(doc.nombre_archivo)}</b>. Adjuntamos la copia firmada.`,
            `Huella SHA-256 del PDF firmado:<br><code style="font-size:12px">${hashFinal}</code>`,
          ],
          boton: esDueno ? { texto: 'Abrir SignApp', url } : undefined,
        }),
      })
    } catch (e) {
      console.error('No se pudo enviar la copia final a', para, e)
    }
  }
}

async function generarPdfFinal(documentoId: string) {
  const { bytes: final, doc, correos } = await armarPdf(documentoId, true)
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

  await enviarCopiaFinal(doc, correos, final, hashFinal)
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
