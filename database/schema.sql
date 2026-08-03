-- ============================================================================
-- SISTEMA DE REQUISIÇÃO DE MATERIAIS - SCHEMA DO BANCO (Supabase / PostgreSQL)
-- ============================================================================
-- Como aplicar:
--   1. Crie um projeto em https://supabase.com (grátis)
--   2. Vá em SQL Editor > New query
--   3. Cole este arquivo inteiro e execute (RUN)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. LIMPEZA (opcional) — descomente as linhas abaixo SOMENTE se você já
--    tentou rodar este script antes e ele falhou no meio, deixando tabelas
--    parciais no banco. Isso apaga tudo e permite recomeçar do zero.
-- ----------------------------------------------------------------------------
-- drop table if exists solicitacao_historico cascade;
-- drop table if exists solicitacao_anexos cascade;
-- drop table if exists solicitacao_itens cascade;
-- drop table if exists solicitacoes cascade;
-- drop table if exists perfis_admin cascade;
-- drop view if exists vw_dashboard_resumo;
-- drop function if exists consultar_protocolo(text);

-- ----------------------------------------------------------------------------
-- 1. EXTENSÕES
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 2. TIPOS ENUMERADOS
-- ----------------------------------------------------------------------------
create type tipo_solicitacao as enum (
  'combustivel',
  'manutencao_veiculo',
  'uniformes_epis',
  'materiais_ferramentas'
);

create type status_solicitacao as enum (
  'recebido',
  'em_analise',
  'separando_material',
  'pronto_retirada',
  'concluido',
  'cancelado'
);

create type nivel_urgencia as enum ('baixa', 'media', 'alta');

-- ----------------------------------------------------------------------------
-- 3. TABELA PRINCIPAL: solicitacoes
-- ----------------------------------------------------------------------------
create table if not exists solicitacoes (
  id                uuid primary key default uuid_generate_v4(),
  protocolo         text unique,

  -- Dados do colaborador (obrigatórios em todos os formulários)
  nome_completo     text not null,
  matricula         text not null,
  equipe            text not null,
  cidade            text not null check (cidade in ('Itaguaí', 'Seropédica', 'Paracambi')),

  -- Tipo e status
  tipo              tipo_solicitacao not null,
  status            status_solicitacao not null default 'recebido',

  -- Campos específicos por tipo (guardados em JSONB para flexibilidade,
  -- assim dá pra adicionar novos tipos de solicitação sem alterar o schema)
  dados             jsonb not null default '{}'::jsonb,

  -- Observações gerais
  observacoes       text,

  -- Controle de tempo
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  atendido_em       timestamptz,

  -- Auditoria de quem alterou o status (usuário do painel admin)
  atualizado_por    text
);

comment on table solicitacoes is 'Solicitações de materiais/combustível/manutenção/uniformes feitas por colaboradores de campo';
comment on column solicitacoes.dados is 'Campos específicos por tipo: {veiculo, placa, km_atual, foto_url}, {itens: [{item, quantidade, tamanho}]}, etc.';

-- ----------------------------------------------------------------------------
-- 3.1 TRIGGER: gera o protocolo automaticamente antes de inserir.
--     (Não pode ser coluna "generated always as" porque to_char() com
--     timestamptz não é uma expressão imutável para o Postgres - erro 42P17.
--     Por isso usamos um trigger BEFORE INSERT, que não tem essa restrição.)
-- ----------------------------------------------------------------------------
create or replace function trg_gerar_protocolo()
returns trigger as $$
begin
  new.protocolo := 'REQ-' || to_char(new.created_at, 'YYYYMMDD') || '-' || substr(new.id::text, 1, 6);
  return new;
end;
$$ language plpgsql;

create trigger gerar_protocolo
before insert on solicitacoes
for each row execute function trg_gerar_protocolo();

-- ----------------------------------------------------------------------------
-- 4. TABELA DE ITENS (para uniformes/EPIs e materiais/ferramentas, que
--    permitem múltiplos itens por solicitação). Normalizado para facilitar
--    relatórios e controle de estoque futuro.
-- ----------------------------------------------------------------------------
create table if not exists solicitacao_itens (
  id                uuid primary key default uuid_generate_v4(),
  solicitacao_id    uuid not null references solicitacoes(id) on delete cascade,
  item              text not null,
  quantidade        numeric not null check (quantidade > 0),
  unidade           text,          -- ex: 'un', 'par', 'metro'
  tamanho           text,          -- ex: 'G', '42', null
  justificativa     text,
  created_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 5. TABELA DE ANEXOS (fotos)
-- ----------------------------------------------------------------------------
create table if not exists solicitacao_anexos (
  id                uuid primary key default uuid_generate_v4(),
  solicitacao_id    uuid not null references solicitacoes(id) on delete cascade,
  storage_path      text not null,   -- caminho dentro do bucket 'anexos'
  tipo_anexo        text default 'foto',
  created_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. TABELA DE HISTÓRICO DE STATUS (para dashboard de tempo médio de
--    atendimento e auditoria)
-- ----------------------------------------------------------------------------
create table if not exists solicitacao_historico (
  id                uuid primary key default uuid_generate_v4(),
  solicitacao_id    uuid not null references solicitacoes(id) on delete cascade,
  status_anterior   status_solicitacao,
  status_novo       status_solicitacao not null,
  alterado_por      text,
  created_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. TABELA DE USUÁRIOS DO PAINEL ADMIN (almoxarifado)
--    Autenticação real via Supabase Auth (auth.users). Esta tabela guarda
--    apenas o perfil/papel de cada usuário autenticado.
-- ----------------------------------------------------------------------------
create table if not exists perfis_admin (
  id                uuid primary key references auth.users(id) on delete cascade,
  nome              text not null,
  papel             text not null default 'almoxarifado' check (papel in ('almoxarifado', 'supervisor', 'admin')),
  ativo             boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 8. ÍNDICES para performance de filtros/dashboard
-- ----------------------------------------------------------------------------
create index if not exists idx_solicitacoes_status on solicitacoes(status);
create index if not exists idx_solicitacoes_tipo on solicitacoes(tipo);
create index if not exists idx_solicitacoes_cidade on solicitacoes(cidade);
create index if not exists idx_solicitacoes_equipe on solicitacoes(equipe);
create index if not exists idx_solicitacoes_created_at on solicitacoes(created_at desc);
create index if not exists idx_itens_solicitacao on solicitacao_itens(solicitacao_id);
create index if not exists idx_anexos_solicitacao on solicitacao_anexos(solicitacao_id);

-- ----------------------------------------------------------------------------
-- 9. TRIGGERS
-- ----------------------------------------------------------------------------

-- 9.1 Atualiza updated_at automaticamente
create or replace function trg_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
before update on solicitacoes
for each row execute function trg_set_updated_at();

-- 9.2 Registra histórico de status + marca atendido_em quando concluído
create or replace function trg_log_status_change()
returns trigger as $$
begin
  if (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into solicitacao_historico (solicitacao_id, status_anterior, status_novo, alterado_por)
    values (new.id, old.status, new.status, new.atualizado_por);

    if new.status = 'concluido' and new.atendido_em is null then
      new.atendido_em = now();
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger log_status_change
before update on solicitacoes
for each row execute function trg_log_status_change();

-- 9.3 Registro inicial no histórico quando a solicitação é criada
create or replace function trg_log_status_initial()
returns trigger as $$
begin
  insert into solicitacao_historico (solicitacao_id, status_anterior, status_novo, alterado_por)
  values (new.id, null, new.status, 'sistema');
  return new;
end;
$$ language plpgsql;

create trigger log_status_initial
after insert on solicitacoes
for each row execute function trg_log_status_initial();

-- ----------------------------------------------------------------------------
-- 10. WEBHOOK DE NOTIFICAÇÃO (dispara o microserviço Python via pg_net)
--     Requer a extensão "pg_net" (disponível no Supabase por padrão).
--     Substitua a URL abaixo pela URL pública do seu backend no Render.
-- ----------------------------------------------------------------------------
create extension if not exists pg_net;

create or replace function trg_notificar_nova_solicitacao()
returns trigger as $$
begin
  perform net.http_post(
    url := 'https://SEU-BACKEND.onrender.com/webhook/nova-solicitacao',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', 'TROQUE_ESTE_SEGREDO'
    ),
    body := jsonb_build_object(
      'id', new.id,
      'protocolo', new.protocolo,
      'nome_completo', new.nome_completo,
      'equipe', new.equipe,
      'cidade', new.cidade,
      'tipo', new.tipo,
      'created_at', new.created_at
    )
  );
  return new;
end;
$$ language plpgsql;

create trigger notificar_nova_solicitacao
after insert on solicitacoes
for each row execute function trg_notificar_nova_solicitacao();

-- ============================================================================
-- 11. ROW LEVEL SECURITY (RLS) — Controle de acesso
-- ============================================================================

alter table solicitacoes enable row level security;
alter table solicitacao_itens enable row level security;
alter table solicitacao_anexos enable row level security;
alter table solicitacao_historico enable row level security;
alter table perfis_admin enable row level security;

-- 11.1 Colaboradores de campo (anônimos, via chave "anon" pública):
--      podem INSERIR solicitações, mas NÃO podem ler a lista completa
--      nem alterar/apagar (evita vazamento de dados de outros colaboradores).
create policy "publico_pode_inserir_solicitacao"
on solicitacoes for insert
to anon
with check (true);

create policy "publico_pode_inserir_itens"
on solicitacao_itens for insert
to anon
with check (true);

create policy "publico_pode_inserir_anexos"
on solicitacao_anexos for insert
to anon
with check (true);

-- 11.2 Usuários autenticados (painel admin / almoxarifado): acesso completo
create policy "admin_select_solicitacoes"
on solicitacoes for select
to authenticated
using (exists (select 1 from perfis_admin p where p.id = auth.uid() and p.ativo = true));

create policy "admin_update_solicitacoes"
on solicitacoes for update
to authenticated
using (exists (select 1 from perfis_admin p where p.id = auth.uid() and p.ativo = true));

create policy "admin_select_itens"
on solicitacao_itens for select
to authenticated
using (exists (select 1 from perfis_admin p where p.id = auth.uid() and p.ativo = true));

create policy "admin_select_anexos"
on solicitacao_anexos for select
to authenticated
using (exists (select 1 from perfis_admin p where p.id = auth.uid() and p.ativo = true));

create policy "admin_select_historico"
on solicitacao_historico for select
to authenticated
using (exists (select 1 from perfis_admin p where p.id = auth.uid() and p.ativo = true));

create policy "admin_ve_proprio_perfil"
on perfis_admin for select
to authenticated
using (id = auth.uid());

-- ============================================================================
-- 12. STORAGE (upload de fotos)
-- ============================================================================
-- Execute isto também no SQL Editor (cria o bucket programaticamente).
-- Alternativa: crie manualmente em Storage > New bucket > "anexos" (privado).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

-- Colaboradores (anon) podem enviar (upload) mas não listar/baixar
create policy "publico_pode_upload_anexo"
on storage.objects for insert
to anon
with check (bucket_id = 'anexos');

-- Admins autenticados podem visualizar os anexos
create policy "admin_pode_ver_anexo"
on storage.objects for select
to authenticated
using (bucket_id = 'anexos' and exists (select 1 from perfis_admin p where p.id = auth.uid() and p.ativo = true));

-- ============================================================================
-- 13. VIEW PARA DASHBOARD (facilita consultas de indicadores)
-- ============================================================================
create or replace view vw_dashboard_resumo as
select
  count(*) as total_solicitacoes,
  count(*) filter (where status not in ('concluido','cancelado')) as pendentes,
  count(*) filter (where status = 'concluido') as concluidas,
  count(*) filter (where tipo = 'combustivel') as total_combustivel,
  count(*) filter (where tipo = 'manutencao_veiculo') as total_manutencao,
  count(*) filter (where tipo = 'uniformes_epis') as total_uniformes,
  count(*) filter (where tipo = 'materiais_ferramentas') as total_materiais,
  avg(extract(epoch from (atendido_em - created_at))/3600) filter (where atendido_em is not null) as tempo_medio_horas
from solicitacoes;

-- ============================================================================
-- 14. FUNÇÃO PÚBLICA DE CONSULTA POR PROTOCOLO (não expõe a tabela inteira)
--     Usada pela tela "Minhas Solicitações" do colaborador de campo.
--     SECURITY DEFINER faz a função rodar com privilégios do dono (ignora RLS),
--     mas ela só retorna os campos abaixo — nunca a tabela completa.
-- ============================================================================
create or replace function consultar_protocolo(p_protocolo text)
returns table (
  protocolo text,
  tipo tipo_solicitacao,
  status status_solicitacao,
  created_at timestamptz,
  atendido_em timestamptz
)
language sql
security definer
set search_path = public
as $$
  select protocolo, tipo, status, created_at, atendido_em
  from solicitacoes
  where protocolo = p_protocolo;
$$;

grant execute on function consultar_protocolo(text) to anon;

-- ============================================================================
-- FIM DO SCHEMA
-- ============================================================================
