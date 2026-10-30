// Contrato de packs do checkout. Os testes comparam estes direitos com PACKS da app.
export const PACKS_TRIAL: Record<string, { flags: string[]; planos: string[] }> = {
  express: { flags: ['express_ativo'], planos: [] },
  expert: { flags: ['seguranca_ativo', 'painel_tv_ativo'], planos: ['portal', 'contratos', 'frota'] },
  pro: { flags: ['seguranca_ativo', 'painel_tv_ativo', 'obras_avancado_ativo', 'materiais_entrega_ativo'], planos: ['assist', 'portal', 'contratos', 'frota', 'armazem'] },
  pro_plus: { flags: ['seguranca_ativo', 'painel_tv_ativo', 'obras_avancado_ativo', 'materiais_entrega_ativo'], planos: ['assist', 'portal', 'contratos', 'frota', 'armazem', 'crm'] },
  supreme: { flags: ['seguranca_ativo', 'painel_tv_ativo', 'obras_avancado_ativo', 'materiais_entrega_ativo'], planos: ['assist', 'portal', 'contratos', 'frota', 'armazem', 'crm', 'erp', 'rondas'] },
};

export function validarPackTrial(plano: unknown, escalao: unknown, blocos: unknown) {
  if (!plano || !Object.hasOwn(PACKS_TRIAL, String(plano))) return null;
  const esc = String(escalao ?? '5');
  const extra = Number(blocos ?? 0);
  if (!['5', '10', '25', '50'].includes(esc) || !Number.isInteger(extra) || extra < 0 || Number(esc) + extra * 5 > 100) {
    throw new Error('Escalão ou blocos de funcionários inválidos.');
  }
  return { plano: String(plano), escalao: esc, blocos: extra, maxFuncionarios: Number(esc) + extra * 5 };
}

export function direitosPackTrial(pack: string, expiracao: string) {
  const def = PACKS_TRIAL[pack];
  if (!def) throw new Error('Pack inválido.');
  const campos: Record<string, unknown> = {};
  for (const flag of def.flags) campos[flag] = true;
  for (const plano of def.planos) {
    campos[plano + '_plano'] = 'demo';
    campos[plano + '_expiracao'] = expiracao;
  }
  return campos;
}

export const PACK_NOMES: Record<string, string> = { express: 'Express', expert: 'Expert', pro: 'Pro', pro_plus: 'Pro+', supreme: 'Supreme' };
export const PACK_PRECOS: Record<string, Record<string, number>> = {
  express: { 5: 42.49, 10: 47.49, 25: 62.49, 50: 102.49 },
  expert: { 5: 52.49, 10: 57.49, 25: 72.49, 50: 112.49 },
  pro: { 5: 72.49, 10: 77.49, 25: 92.49, 50: 132.49 },
  pro_plus: { 5: 82.48, 10: 87.48, 25: 102.48, 50: 142.48 },
  supreme: { 5: 102.49, 10: 107.49, 25: 122.49, 50: 162.49 },
};
export function precoPack(pack: string, escalao: string, blocos: number, anual: boolean) {
  const mensal = PACK_PRECOS[pack][escalao] + blocos * 5;
  return +(anual ? mensal * 12 * 0.9 : mensal).toFixed(2);
}
