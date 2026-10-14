import type { Request, Response, NextFunction } from 'express'
import { admin } from './supabase.js'

// Verifica el token de sesión que manda el frontend y deja el usuario en res.locals
export async function requiereUsuario(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Falta el token.' })

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'Sesión no válida.' })

  res.locals.usuario = data.user
  next()
}
