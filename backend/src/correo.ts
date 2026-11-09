import nodemailer from 'nodemailer'

// Tres modos, en este orden de prioridad:
//  1. BREVO_API_KEY  -> API HTTP de Brevo (para producción: Render gratis bloquea el SMTP)
//  2. SMTP_USER/PASS -> SMTP (para trabajar en local)
//  3. nada           -> los correos se simulan en la terminal
const apiKey = process.env.BREVO_API_KEY
const usuario = process.env.SMTP_USER
const clave = process.env.SMTP_PASS
const remitente = process.env.SMTP_FROM ?? usuario

const transporte =
  !apiKey && usuario && clave
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

if (apiKey) {
  console.log('Correo: usando la API HTTP de Brevo, los correos se envían de verdad.')
  if (!remitente) console.error('Correo: falta SMTP_FROM (el remitente verificado en Brevo).')
} else if (transporte) {
  transporte
    .verify()
    .then(() => console.log('Correo: conexión SMTP lista, los correos se envían de verdad.'))
    .catch((e) => console.error('Correo: no se pudo conectar al SMTP:', e.message))
} else {
  console.log('Correo: sin credenciales, los correos se simulan en esta terminal.')
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
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  if (apiKey) {
    if (!remitente) throw new Error('Falta SMTP_FROM: el remitente debe estar verificado en Brevo.')
    const respuesta = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'SignApp', email: remitente },
        to: [{ email: para }],
        subject: asunto,
        htmlContent: html,
        textContent: texto,
        ...(adjuntos?.length
          ? { attachment: adjuntos.map((a) => ({ name: a.filename, content: a.content.toString('base64') })) }
          : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!respuesta.ok) throw new Error(`Brevo API ${respuesta.status}: ${await respuesta.text()}`)
    return
  }

  if (!transporte) {
    const lista = adjuntos?.length
      ? `\n  Adjuntos: ${adjuntos.map((a) => `${a.filename} (${Math.round(a.content.length / 1024)} KB)`).join(', ')}`
      : ''
    console.log(`\n[CORREO SIMULADO]\n  Para:   ${para}\n  Asunto: ${asunto}${enlace ? `\n  Enlace: ${enlace}` : ''}${lista}\n`)
    return
  }

  await transporte.sendMail({
    from: `SignApp <${remitente}>`,
    to: para,
    subject: asunto,
    html,
    text: texto,
    attachments: adjuntos,
  })
}
