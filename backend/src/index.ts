import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { rutasDocumentos } from './rutas/documentos.js'
import { rutasFirmar } from './rutas/firmar.js'

const app = express()
app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin: process.env.FRONTEND_URL }))
app.use(express.json({ limit: '5mb' }))

app.get('/api/salud', (_req, res) => res.json({ ok: true }))

// Los enlaces de firma son públicos: se limita la cantidad de peticiones por IP
app.use('/api/firmar', rateLimit({ windowMs: 60_000, limit: 60 }))

app.use('/api', rutasDocumentos)
app.use('/api', rutasFirmar)

const puerto = Number(process.env.PORT ?? 3001)
app.listen(puerto, () => console.log(`API escuchando en http://localhost:${puerto}`))
