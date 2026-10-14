import { Router } from 'express'
import { admin } from '../supabase.js'
import { requiereUsuario } from '../autenticacion.js'
import { enviarCorreo, esc } from '../correo.js'

export const rutasDocumentos = Router()

rutasDocumentos.post('/documentos/:id/enviar', requiereUsuario, async (req, res) => {
  const usuario = res.locals.usuario
  const id = req.params.id

  // 1. El documento debe ser del usuario y seguir en borrador
  const { data: doc } = await admin
    .from('documentos')
    .select('id, nombre_archivo, estado')
    .eq('id', id)
    .eq('propietario_id', usuario.id)
    .maybeSingle()
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado.' })
  if (doc.estado !== 'borrador') return res.status(409).json({ error: 'Este documento ya fue enviado.' })

  // 2. Debe haber firmantes y cada uno necesita al menos una zona
  const { data: sols, error } = await admin
    .from('solicitudes_firma')
    .select('id, firmante_correo, token_acceso, zonas_firma(id)')
    .eq('documento_id', id)
  if (error) return res.status(500).json({ error: error.message })
  if (!sols?.length) return res.status(400).json({ error: 'Agrega al menos un firmante.' })

  const sinZona = sols.filter((s) => s.zonas_firma.length === 0)
  if (sinZona.length) {
    return res.status(400).json({
      error: `Falta marcar la zona de firma de: ${sinZona.map((s) => s.firmante_correo).join(', ')}`,
    })
  }

  // 3. Cambio de estado atómico: si dos envíos llegan a la vez, solo uno pasa
  const { data: cambiado } = await admin
    .from('documentos')
    .update({ estado: 'en_proceso' })
    .eq('id', id)
    .eq('estado', 'borrador')
    .select('id')
  if (!cambiado?.length) return res.status(409).json({ error: 'Este documento ya fue enviado.' })

  // 4. Vincular firmantes que ya tienen cuenta
  const { data: perfiles } = await admin
    .from('profiles')
    .select('id, correo')
    .in('correo', sols.map((s) => s.firmante_correo))
  for (const p of perfiles ?? []) {
    await admin.from('solicitudes_firma').update({ firmante_id: p.id })
      .eq('documento_id', id).eq('firmante_correo', p.correo)
  }

  // 5. Auditoría
  await admin.from('auditoria').insert({
    documento_id: id,
    usuario_id: usuario.id,
    accion: 'envio',
    ip: req.ip,
  })

  // 6. Correos con el enlace personal de cada firmante
  const remitente = esc(usuario.user_metadata?.nombre ?? usuario.email ?? 'Alguien')
  const fallidos: string[] = []
  for (const s of sols) {
    const enlace = `${process.env.FRONTEND_URL}/firmar/${s.token_acceso}`
    try {
      await enviarCorreo({
        para: s.firmante_correo,
        asunto: `Te enviaron un documento para firmar: ${doc.nombre_archivo}`,
        enlace,
        html: `<p>Hola,</p>
<p><b>${remitente}</b> te envió el documento <b>${esc(doc.nombre_archivo)}</b> para que lo firmes.</p>
<p><a href="${enlace}">Abrir y firmar</a></p>
<p>Solo podrás firmar en la zona que el remitente definió para ti.</p>`,
      })
    } catch (e) {
      console.error('No se pudo enviar el correo a', s.firmante_correo, e)
      fallidos.push(s.firmante_correo)
    }
  }

  res.json({ ok: true, fallidos })
})
