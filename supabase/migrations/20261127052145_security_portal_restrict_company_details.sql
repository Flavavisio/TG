alter policy portal_empresa_propria on public.administradores to authenticated
using (not coalesce((select public.tg_e_cliente()), false));
