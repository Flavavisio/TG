type Perfil = { papel: string; admin_id: string | null; registo_id: string | null };

export function tokenBearer(req: Request): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1];
}

export async function perfilAutenticado(supabase, token: string): Promise<Perfil | null> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  const { data: perfil, error: erroPerfil } = await supabase.from("perfis")
    .select("papel, admin_id, registo_id").eq("id", data.user.id).maybeSingle();
  if (erroPerfil) throw erroPerfil;
  return perfil;
}

export function empresaDoPerfil(perfil: Perfil): string | null {
  return perfil.papel === "admin" ? perfil.registo_id : perfil.admin_id;
}
