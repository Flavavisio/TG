-- As políticas de relatórios ainda resolvem perfis pelo search_path da função chamadora.
alter function public.tg_apagar_ordem_servico(text) set search_path to pg_catalog, public, pg_temp;
