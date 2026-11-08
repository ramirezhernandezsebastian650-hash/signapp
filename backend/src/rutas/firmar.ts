import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { admin } from '../supabase.js'
import { enviarCorreo, esc, plantilla } from '../correo.js'
import { intentarFinalizar, pdfVistaPrevia } from '../pdf.js'

export const rutasFirmar = Router()

const tokenSchema = z.string().uuid()
const MAX_IMAGEN = 2 * 1024 * 1024

async function auditar(documentoId: string, accion: string, ip?: string) {
  const { error } = await admin.from('auditoria').insert({ documento_id: documentoId, accion, ip })
  if (error) console.error('auditoria:', error.message)
}

// Evita llenar el historial con aperturas repetidas (recargas, modo desarrollo)
async function auditarApertura(documentoId: string, correo: string, ip?: string) {
  const accion = `apertura por ${correo}`
  const desde = new Date(Date.now() - 60_000).toISOString()
  const { count } = await admin
    .from('auditoria')
    .select('id', { count: 'exact', head: true })
    .eq('documento_id', documentoId)
    .eq('accion', accion)
    .gte('fecha_hora', desde)
  if (!count) await auditar(documentoId, accion, ip)
}

// Carga la solicitud del enlace. El token es el "permiso" del firmante.
async function cargar(req: Request, res: Response, next: NextFunction) {
  const token = tokenSchema.safeParse(req.params.token)
  if (!token.success) return res.status(404).json({ error: 'Enlace no válido.' })

  const { data: sol } = await admin
    .from('solicitudes_firma')
    .select('id, firmante_correo, estado, documentos(id, nombre_archivo, estado, storage_path, storage_path_final, propietario_id), zonas_firma(pagina, pos_x, pos_y, ancho, alto)')
    .eq('token_acceso', token.data)
    .maybeSingle()
  if (!sol) return res.status(404).json({ error: 'Enlace no válido.' })

  const doc = Array.isArray(sol.documentos) ? sol.documentos[0] : sol.documentos
  // Un documento en borrador todavía no se envió: su enlace no abre nada
  if (!doc || doc.estado === 'borrador') return res.status(404).json({ error: 'Enlace no válido.' })

  res.locals.sol = sol
  res.locals.doc = doc
  res.locals.puede = sol.estado === 'pendiente' && doc.estado === 'en_proceso'
  next()
}

// 1. Información del enlace: la persona puede revisarlo siempre; firmar solo si le toca
rutasFirmar.get('/firmar/:token', cargar, async (req, res) => {
  const { sol, doc, puede } = res.locals
  await auditarApertura(doc.id, sol.firmante_correo, req.ip)

  const { data: todos } = await admin
    .from('solicitudes_firma')
    .select('firmante_correo, estado')
    .eq('documento_id', doc.id)
    .order('orden_firma')

  const zonas = [...sol.zonas_firma].sort((a: any, b: any) => a.pagina - b.pagina || a.pos_y - b.pos_y)
  res.json({
    nombreDocumento: doc.nombre_archivo,
    firmanteCorreo: sol.firmante_correo,
    estadoSolicitud: sol.estado,
    estadoDocumento: doc.estado,
    puedeFirmar: puede,
    zonas: puede ? zonas : [],
    firmantes: todos ?? [],
    documentoFinal: doc.estado === 'firmado' && Boolean(doc.storage_path_final),
  })
})

// 2. El PDF: la copia final si ya firmaron todos; si no, el original con las firmas de ahora
rutasFirmar.get('/firmar/:token/pdf', cargar, async (_req, res) => {
  const { doc } = res.locals
  let bytes: Buffer

  if (doc.estado === 'firmado' && doc.storage_path_final) {
    const { data, error } = await admin.storage.from('firmados').download(doc.storage_path_final)
    if (error || !data) return res.status(500).json({ error: 'No se pudo leer el documento.' })
    bytes = Buffer.from(await data.arrayBuffer())
  } else {
    try {
      bytes = Buffer.from(await pdfVistaPrevia(doc.id))
    } catch (e) {
      console.error('Vista previa:', e)
      return res.status(500).json({ error: 'No se pudo preparar la vista del documento.' })
    }
  }

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Cache-Control', 'no-store')
  res.send(bytes)
})

// 3. Firmar: el cuerpo trae SOLO la imagen; la posición sale de la base de datos
const cuerpoFirma = z.object({
  tipo: z.enum(['dibujada', 'imagen']),
  imagen: z.string().max(3_000_000),
})

rutasFirmar.post('/firmar/:token/firmar', cargar, async (req, res) => {
  const { sol, doc, puede } = res.locals
  if (!puede) return res.status(409).json({ error: 'Este documento ya no está disponible para firma.' })

  const cuerpo = cuerpoFirma.safeParse(req.body)
  if (!cuerpo.success) return res.status(400).json({ error: 'Datos de firma no válidos.' })

  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(cuerpo.data.imagen)
  if (!m) return res.status(400).json({ error: 'La firma debe ser una imagen PNG o JPG.' })

  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length > MAX_IMAGEN) return res.status(400).json({ error: 'La imagen supera los 2 MB.' })
  const esPng = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const esJpg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  if ((m[1] === 'png' && !esPng) || (m[1] === 'jpeg' && !esJpg)) {
    return res.status(400).json({ error: 'El archivo no es una imagen válida.' })
  }

  const ext = m[1] === 'png' ? 'png' : 'jpg'
  const ruta = `${doc.id}/${sol.id}.${ext}`

  const { error: eSubida } = await admin.storage
    .from('firmas')
    .upload(ruta, bytes, { contentType: `image/${m[1]}`, upsert: true })
  if (eSubida) return res.status(500).json({ error: eSubida.message })

  // La llave primaria de firmas (solicitud_id) hace de cerrojo: una firma por solicitud
  const { error: eFirma } = await admin
    .from('firmas')
    .insert({ solicitud_id: sol.id, tipo: cuerpo.data.tipo, archivo_firma_path: ruta })
  if (eFirma) {
    return eFirma.code === '23505'
      ? res.status(409).json({ error: 'Ya firmaste este documento.' })
      : res.status(500).json({ error: eFirma.message })
  }

  const { error: eEstado } = await admin
    .from('solicitudes_firma')
    .update({ estado: 'firmado' })
    .eq('id', sol.id)
  if (eEstado) return res.status(500).json({ error: eEstado.message })

  await auditar(doc.id, `firma de ${sol.firmante_correo}`, req.ip)
  const resultado = await intentarFinalizar(doc.id)
  res.json({ ok: true, completo: resultado === 'completo' })
})

// 4. Rechazar con motivo
const cuerpoRechazo = z.object({ motivo: z.string().trim().min(3).max(500) })

rutasFirmar.post('/firmar/:token/rechazar', cargar, async (req, res) => {
  const { sol, doc, puede } = res.locals
  if (!puede) return res.status(409).json({ error: 'Este documento ya no está disponible para firma.' })

  const cuerpo = cuerpoRechazo.safeParse(req.body)
  if (!cuerpo.success) return res.status(400).json({ error: 'Escribe el motivo del rechazo (mínimo 3 caracteres).' })

  const { data: cambiada } = await admin
    .from('solicitudes_firma')
    .update({ estado: 'rechazado', motivo_rechazo: cuerpo.data.motivo })
    .eq('id', sol.id)
    .eq('estado', 'pendiente')
    .select('id')
  if (!cambiada?.length) return res.status(409).json({ error: 'Ya respondiste a esta solicitud.' })

  await admin.from('documentos').update({ estado: 'rechazado' }).eq('id', doc.id).eq('estado', 'en_proceso')
  await auditar(doc.id, `rechazo de ${sol.firmante_correo}`, req.ip)

  try {
    const { data: dueno } = await admin.from('profiles').select('correo').eq('id', doc.propietario_id).single()
    if (dueno) {
      await enviarCorreo({
        para: dueno.correo,
        asunto: `Documento rechazado: ${doc.nombre_archivo}`,
        html: plantilla({
          titulo: 'Documento rechazado',
          parrafos: [
            `<b>${esc(sol.firmante_correo)}</b> rechazó <b>${esc(doc.nombre_archivo)}</b>.`,
            `Motivo: ${esc(cuerpo.data.motivo)}`,
          ],
        }),
      })
    }
  } catch (e) {
    console.error('No se pudo avisar al propietario:', e)
  }

  res.json({ ok: true })
})
