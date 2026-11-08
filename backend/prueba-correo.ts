import 'dotenv/config'
import { enviarCorreo, plantilla } from './src/correo.js'

await enviarCorreo({
  para: process.argv[2],
  asunto: 'Prueba de SignApp',
  html: plantilla({
    titulo: 'Prueba',
    parrafos: ['Si lees esto, los correos de SignApp funcionan.'],
    boton: { texto: 'Abrir SignApp', url: 'http://localhost:5173/' },
  }),
})
console.log('Enviado')
