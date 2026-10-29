alter table public.administradores alter column layout set default 'aurora';

create or replace function public.tg_layout_nexus_por_omissao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.layout := coalesce(nullif(btrim(new.layout), ''), 'aurora');
    return new;
end;
$$;

create trigger tg_layout_nexus_novas_contas
before insert on public.administradores
for each row execute function public.tg_layout_nexus_por_omissao();
