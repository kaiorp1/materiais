/**
 * Configuração do cliente Supabase.
 *
 * IMPORTANTE: a "anon key" abaixo é PÚBLICA por design (Supabase foi feito
 * para isso) — a segurança real é garantida pelas políticas de RLS definidas
 * em database/schema.sql (colaboradores só podem INSERIR, nunca LER a lista
 * inteira de solicitações de outras pessoas).
 *
 * Substitua os dois valores abaixo pelos do SEU projeto Supabase:
 * Project Settings > API > Project URL / Project API keys > anon public
 */
const SUPABASE_URL = 'https://lbeygpdcpkhkulvmwlan.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jmOI21Hnk0HpVxR-AGW2Xg_Y5sIDymR';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
