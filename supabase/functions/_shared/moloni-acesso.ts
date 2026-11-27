export async function autorizarMoloni(req, supabase, serviceKey, empresa, apenasInterno = false) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!token) return 401;
  if (token === serviceKey) return 200;
  if (apenasInterno) return 403;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return 401;
  const { data: perfil, error: falhaPerfil } = await supabase.from("perfis")
    .select("papel, admin_id, registo_id").eq("id", data.user.id).maybeSingle();
  if (falhaPerfil) throw falhaPerfil;
  const autorizado = perfil?.papel === "admin" && perfil.registo_id === empresa ||
    perfil?.papel === "subadmin" && perfil.admin_id === empresa;
  return autorizado ? 200 : 403;
}

export async function obterMoloni(supabase, empresa, dadosPublicos) {
  const { data: credenciais, error } = await supabase.rpc("tg_moloni_credenciais", { admin: empresa });
  if (error) throw error;
  if (!credenciais) throw new Error("As credenciais da Moloni ainda não foram configuradas.");
  return { ...dadosPublicos, ...credenciais };
}
