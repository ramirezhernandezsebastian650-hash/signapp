import nodemailer from 'nodemailer'

const usuario = process.env.SMTP_USER
const clave = process.env.SMTP_PASS
const hayCredenciales = Boolean(usuario && clave)

// Gmail por defecto; con SMTP_HOST se puede usar cualquier otro proveedor
const transporte = hayCredenciales
  ? nodemailer.createTransport(
      process.env.SMTP_HOST
        ? {
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: { user: usuario, pass: clave },
          }
        : { service: 'gmail', auth: { user: usuario, pass: clave } }
    )
  : null

if (transporte) {
  transporte
    .verify()
    .then(() => console.log('Correo: conexión SMTP lista, los correos se envían de verdad.'))
    .catch((e) => console.error('Correo: no se pudo conectar al SMTP:', e.message))
} else {
  console.log('Correo: sin credenciales SMTP, los correos se simulan en esta terminal.')
}

export const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Boton = { texto: string; url: string }

// Los párrafos llegan ya escapados por quien llama (usa esc() con datos de usuarios)
export function plantilla({ titulo, parrafos, boton }: { titulo: string; parrafos: string[]; boton?: Boton }) {
  const cuerpo = parrafos.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${p}</p>`).join('')
  const accion = boton
    ? `<p style="margin:24px 0"><a href="${boton.url}" style="background:#1e3a8a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${esc(boton.texto)}</a></p>
<p style="font-size:12px;color:#64748b">Si el botón no funciona, copia este enlace en tu navegador:<br>${boton.url}</p>`
    : ''
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
<h2 style="color:#1e3a8a;margin-bottom:4px">SignApp</h2>
<h3 style="margin-top:0">${esc(titulo)}</h3>${cuerpo}${accion}</div>`
}

type Adjunto = { filename: string; content: Buffer }
type Correo = { para: string; asunto: string; html: string; enlace?: string; adjuntos?: Adjunto[] }

export async function enviarCorreo({ para, asunto, html, enlace, adjuntos }: Correo) {
  if (!transporte) {
    const lista = adjuntos?.length
      ? `\n  Adjuntos: ${adjuntos.map((a) => `${a.filename} (${Math.round(a.content.length / 1024)} KB)`).join(', ')}`
      : ''
    console.log(`\n[CORREO SIMULADO]\n  Para:   ${para}\n  Asunto: ${asunto}${enlace ? `\n  Enlace: ${enlace}` : ''}${lista}\n`)
    return
  }
  await transporte.sendMail({
    from: `SignApp <${process.env.SMTP_FROM ?? usuario}>`,
    to: para,
    subject: asunto,
    html,
    text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    attachments: adjuntos,
  })
}
