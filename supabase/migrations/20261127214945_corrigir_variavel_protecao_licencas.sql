-- Evita ambiguidade entre a variável da função e a coluna empresa.
create or replace function tg_internal.proteger_licenca_tg()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
    campos text[] := array[
        'pack_atual','pack_escalao','pack_blocos','contratos_plano','contratos_expiracao',
        'frota_plano','frota_expiracao','armazem_plano','armazem_expiracao','portal_plano',
        'portal_expiracao','crm_plano','crm_expiracao','notificacoes_plano','notificacoes_expiracao',
        'erp_plano','erp_expiracao','assist_plano','assist_expiracao','rondas_plano','rondas_expiracao',
        'eh_distribuidor','distribuidor_id','distribuidor_desconto','preco_distribuidor_cobrado',
        'preco_fundador','distribuidor_pagamento_prazo','lembrete_pagamento_em','licenca_feedback'
    ];
    empresa_alvo text;
    gestor_distribuidor boolean;
    empresa_anterior jsonb;
    empresa_nova jsonb;
begin
    if current_user not in ('anon','authenticated') or public.tg_superadmin() then
        if tg_op = 'DELETE' then return old; end if;
        return new;
    end if;

    if tg_table_name = 'administradores' then
        if tg_op = 'UPDATE' then
            empresa_anterior := to_jsonb(old);
            empresa_nova := to_jsonb(new);
            if not exists (
                select 1 from unnest(campos) as campo
                where empresa_anterior->campo is distinct from empresa_nova->campo
            ) and old.id = new.id and old.ativo is not distinct from new.ativo then
                return new;
            end if;
            if old.id is distinct from new.id or old.distribuidor_id is distinct from new.distribuidor_id
                or old.eh_distribuidor is distinct from new.eh_distribuidor
                or old.distribuidor_desconto is distinct from new.distribuidor_desconto
                or old.preco_fundador is distinct from new.preco_fundador then
                raise insufficient_privilege using message = 'Os direitos da empresa são geridos pelo Total Gest.';
            end if;
            empresa_alvo := old.distribuidor_id;
        else
            if new.eh_distribuidor is true or new.distribuidor_desconto is not null or new.preco_fundador is true
                or new.id = public.tg_admin_id() then
                raise insufficient_privilege using message = 'Os direitos da empresa são geridos pelo Total Gest.';
            end if;
            empresa_alvo := new.distribuidor_id;
        end if;
    else
        if tg_op = 'DELETE' then empresa_alvo := old.admin_id;
        else empresa_alvo := new.admin_id; end if;
        if tg_op = 'UPDATE' and old.admin_id is distinct from new.admin_id then
            raise insufficient_privilege using message = 'Não é possível transferir a licença.';
        end if;
        if tg_op = 'UPDATE' and old.pendente_24h is true and old.limite_24h <= statement_timestamp()
            and new.ativa is false and new.pendente_24h is false
            and to_jsonb(old) - array['ativa','pendente_24h'] = to_jsonb(new) - array['ativa','pendente_24h'] then
            return new;
        end if;
        select a.distribuidor_id into empresa_alvo from public.administradores a where a.id = empresa_alvo;
    end if;

    select coalesce(d.eh_distribuidor, false) into gestor_distribuidor
    from public.administradores d
    join public.perfis p on p.id = auth.uid() and p.papel = 'admin' and p.registo_id = d.id
    where d.id = empresa_alvo;
    if not coalesce(gestor_distribuidor, false) then
        raise insufficient_privilege using message = 'A licença só pode ser alterada por um gestor autorizado.';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end
$$;
