-- TOTAL GEST — AUDITORIA RLS DE PRODUÇÃO (SOMENTE LEITURA)
-- Data: 2026-10-20
-- Executar no SQL Editor do projeto Supabase ligado a www.totalgest.pt.
-- NÃO modifica dados, políticas, grants, funções, utilizadores nem sessões.
-- NÃO devolve registos de clientes ou dados pessoais.

-- 1. Tabelas acessíveis pela Data API (esquema public): RLS, grants e exposição.
SELECT
  n.nspname AS schema,
  c.relname AS tabela,
  c.relrowsecurity AS rls_ativo,
  c.relforcerowsecurity AS rls_forcado,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
  has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') AS auth_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') AS auth_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY CASE WHEN c.relrowsecurity THEN 1 ELSE 0 END, c.relname;

-- 2. Políticas RLS. Procurar USING(true), auth.role() apenas,
-- políticas permissivas sem verificação de empresa/usuário e ausência WITH CHECK.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- 3. Views expostas (SECURITY INVOKER deve ser true quando aplicável).
SELECT n.nspname AS schema, c.relname AS view_name, c.relkind,
  COALESCE('security_invoker=true' = ANY(c.reloptions), false) AS security_invoker,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
ORDER BY c.relname;

-- 4. Funções SECURITY DEFINER executáveis por anon/authenticated.
SELECT n.nspname AS schema,
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS function_signature,
  p.prosecdef AS security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'tg_private')
  AND p.prosecdef
ORDER BY n.nspname, p.proname;

-- 5. Buckets (apenas configuração, sem ficheiros).
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY name;

-- 6. Funções de autorização e perfis: catálogo de colunas (sem dados).
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN ('perfis', 'administradores', 'funcionarios', 'encarregados',
                  'clientes', 'servicos', 'assistencias', 'contratos', 'obras',
                  'licencas', 'equipamentos', 'locais', 'folhas_obra')
ORDER BY table_name, ordinal_position;

-- 7. Exposição de colunas sensíveis a anon/authenticated.
-- Estes grants são indicativos; testar também RLS e caminhos RPC.
SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND column_name ~* '(senha|password|token|secret|api_key|pin|salario|ordenado|iban|chave)'
ORDER BY table_name, column_name, grantee, privilege_type;
