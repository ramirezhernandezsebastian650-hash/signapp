import nodemailer from 'nodemailer'

const hayCredenciales = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS)
const transporte = hayCredenciales
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null

export const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Correo = { para: string; asunto: string; html: string; enlace: string }

export async function enviarCorreo({ para, asunto, html, enlace }: Correo) {
  if (!transporte) {
    // Sin credenciales SMTP: se imprime el enlace en la terminal para poder probar
    console.log(`\n[CORREO SIMULADO]\n  Para:   ${para}\n  Asunto: ${asunto}\n  Enlace: ${enlace}\n`)
    return
  }
  await transporte.sendMail({ from: `SignApp <${process.env.SMTP_USER}>`, to: para, subject: asunto, html })
}
