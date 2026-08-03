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
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiZXlncGRjcGtoa3Vsdm13bGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NDEwMzYsImV4cCI6MjEwMTMxNzAzNn0.f_I6FNTZ4urGfTAXmblxeTjO5kdITrkXRXqEzqCdv0U';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
