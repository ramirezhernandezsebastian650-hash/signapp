import { createClient } from '@supabase/supabase-js'

// Cliente con la llave secreta: se salta las reglas RLS. Solo vive en el backend.
export const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } }
)
