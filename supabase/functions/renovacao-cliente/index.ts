// ============================================================================
//  Edge Function: renovacao-cliente
//  Endpoint PÚBLICO (sem login) usado pela página que abre a partir do link
//  no email de aviso de licença a vencer/vencida. Permite ao cliente:
//    - Renovar o mesmo plano (+ opcionalmente add-ons)
//    - Escolher um plano diferente (+ opcionalmente add-ons)
//    - Cancelar a subscrição
//  Tudo fica registado como pedido PENDENTE — o Super Admin continua a ter
//  de aprovar, exatamente como quando o pedido é feito de dentro da app.
//
//  Deploy (painel Supabase):
//   Edge Functions > renovacao-cliente > Code > colar isto > Deploy.
//   DESLIGAR "Verify JWT" nesta função — tem de ser acessível sem sessão,
//   a segurança vem do token (aleatório, por admin, com validade).
//
//  ATUALIZAÇÃO (vs. versão anterior): a tabela de preços (PLANOS) desta
//  função vivia SOZINHA, à parte da do app-principal.js — e tinha ficado
//  desatualizada, com valores mais baixos do que os reais. Um cliente a
//  renovar pelo link do email via preços diferentes dos que aparecem dentro
//  da app. Atualizados agora para baterem certo com os dois sítios.
//
//  Body esperado:
//   - Obter informação:  { acao: "info", token }
//   - Submeter escolha:   { acao: "submeter", token, escolha: "renovar" | "outro_plano" | "cancelar",
//                           planoEscolhido?: string,
//                           addons?: { contratos?: "mensal"|"anual", frota?: "mensal"|"anual", armazem?: "mensal"|"anual", rondas?: "mensal"|"anual" } }
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { PACKS_TRIAL, PACK_NOMES, validarPackTrial, precoPack } from '../_shared/packs.ts';

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Igual à tabela PLANOS do app-principal.js — mantém os dois alinhados sempre que os preços
// mudarem (é o único outro sítio onde os preços das licenças estão hardcoded).
const PLANOS: Record<string, { dias: number; funcionarios: number; preco: number; label: string }> = {
  "30_5": { dias: 30, funcionarios: 5, preco: 29.99, label: "30 dias - 5 func." },
  "30_10": { dias: 30, funcionarios: 10, preco: 34.99, label: "30 dias - 10 func." },
  "30_25": { dias: 30, funcionarios: 25, preco: 49.99, label: "30 dias - 25 func." },
  "30_50": { dias: 30, funcionarios: 50, preco: 89.99, label: "30 dias - 50 func." },
  "30_100": { dias: 30, funcionarios: 100, preco: 179.90, label: "30 dias - 100 func." },
  "365_5": { dias: 365, funcionarios: 5, preco: +(29.99 * 12 * 0.9).toFixed(2), label: "365 dias - 5 func. (10% desc)" },
  "365_10": { dias: 365, funcionarios: 10, preco: +(34.99 * 12 * 0.9).toFixed(2), label: "365 dias - 10 func. (10% desc)" },
  "365_25": { dias: 365, funcionarios: 25, preco: +(49.99 * 12 * 0.9).toFixed(2), label: "365 dias - 25 func. (10% desc)" },
  "365_50": { dias: 365, funcionarios: 50, preco: +(89.99 * 12 * 0.9).toFixed(2), label: "365 dias - 50 func. (10% desc)" },
  "365_100": { dias: 365, funcionarios: 100, preco: +(179.90 * 12 * 0.9).toFixed(2), label: "365 dias - 100 func. (10% desc)" },
};
const PRECO_ADDON = {
  contratos: { mensal: 14.99, anual: +(14.99 * 12 * 0.9).toFixed(2) },
  frota: { mensal: 9.99, anual: +(9.99 * 12 * 0.9).toFixed(2) },
  armazem: { mensal: 9.99, anual: +(9.99 * 12 * 0.9).toFixed(2) },
  // Rondas / Vigilância — grátis por agora (fase de lançamento). Quando passar a ter preço,
  // basta mudar estes dois valores; o resto do fluxo (pedido, aprovação) já está pronto.
  rondas: { mensal: 0, anual: 0 },
};
// Lista dos módulos aceites no campo "addons" do pedido — controla tanto o que "info" devolve
// (precosAddon) como o que "submeter" aceita gravar. Acrescentar aqui é o único sítio a mudar
// para dar suporte a um novo módulo neste fluxo por email.
const MODULOS_ADDON = ["contratos", "frota", "armazem", "rondas"] as const;
type ModuloAddon = typeof MODULOS_ADDON[number];

async function validarToken(service: any, token: string) {
  if (!token) return { erro: "Token em falta" };
  const { data: admin, error } = await service.from("administradores").select("*").eq("token_renovacao", token).maybeSingle();
  if (error) return { erro: error.message };
  if (!admin) return { erro: "Link inválido ou já utilizado." };
  if (admin.token_renovacao_expira && new Date(admin.token_renovacao_expira).getTime() < Date.now()) {
    return { erro: "Este link expirou. Pede um novo aviso ou entra na aplicação para tratares da tua licença." };
  }
  return { admin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { acao, token } = body;
    if (!acao || !token) return json({ erro: "Faltam dados (acao, token)." }, 400);

    const { admin, erro } = await validarToken(service, token);
    if (erro) return json({ erro }, 400);

    const { data: lic } = await service.from("licencas").select("*").eq("admin_id", admin.id).maybeSingle();
    const pack = validarPackTrial(admin.pack_atual, admin.pack_escalao === '50+' ? '50' : admin.pack_escalao, admin.pack_blocos);
    const anual = Number(lic?.dias) === 365;
    const labelPack = (p: string) => `Pack ${PACK_NOMES[p]} — ${anual ? 'Anual' : 'Mensal'} (${pack?.maxFuncionarios} func.)`;

    if (acao === "info") {
      return json({
        ok: true,
        empresa: admin.empresa,
        nome: admin.nome,
        planoAtual: lic?.plano || null,
        planoAtualLabel: lic?.plano ? (PLANOS[lic.plano]?.label || lic.plano) : "—",
        dataExpiracao: lic?.data_expiracao || null,
        addonsAtuais: {
          contratos: admin.contratos_plano || null,
          frota: admin.frota_plano || null,
          armazem: admin.armazem_plano || null,
          rondas: admin.rondas_plano || null,
        },
        planosDisponiveis: Object.entries(PLANOS).map(([key, p]) => ({ key, label: p.label, preco: p.preco })),
        precosAddon: PRECO_ADDON,
        ...(pack ? {
          packAtual: pack.plano,
          planoAtual: pack.plano,
          planoAtualLabel: labelPack(pack.plano) + ' — ' + precoPack(pack.plano, pack.escalao, pack.blocos, anual).toFixed(2) + ' €',
          planosDisponiveis: Object.keys(PACKS_TRIAL).map(key => ({ key, label: labelPack(key), preco: precoPack(key, pack.escalao, pack.blocos, anual) })),
        } : {}),
      });
    }

    if (acao === "submeter") {
      const { escolha, planoEscolhido, addons } = body;
      if (!["renovar", "outro_plano", "cancelar"].includes(escolha)) {
        return json({ erro: "Escolha inválida." }, 400);
      }

      const agora = new Date().toISOString();

      if (escolha === "cancelar") {
        await service.from("pedidos_renovacao").insert({
          id: crypto.randomUUID(),
          admin_id: admin.id,
          tipo: "cancelamento",
          plano_atual: lic?.plano || null,
          plano_pedido: null,
          observacao: "Pedido de cancelamento de subscrição submetido pelo cliente via link de email.",
          status: "pendente",
          data_criacao: agora,
        });
        // token de uso único — invalida depois de submeter
        await service.from("administradores").update({ token_renovacao: null, token_renovacao_expira: null }).eq("id", admin.id);
        return json({ ok: true, mensagem: "Pedido de cancelamento recebido. A nossa equipa vai entrar em contacto." });
      }

      if (pack) {
        const escolhido = escolha === 'renovar' ? pack.plano : String(planoEscolhido);
        if (!Object.hasOwn(PACKS_TRIAL, escolhido)) return json({ erro: 'Pack inválido.' }, 400);
        const valor = precoPack(escolhido, pack.escalao, pack.blocos, anual);
        const { error } = await service.from('pedidos_renovacao').insert({
          id: crypto.randomUUID(), admin_id: admin.id, tipo: 'pack',
          pack_pedido: escolhido, escalao_pedido: pack.escalao, blocos_pedido: pack.blocos,
          periodo_pedido: anual ? 'anual' : 'mensal', func_max: pack.maxFuncionarios,
          valor, status: 'pendente', data_criacao: agora,
          observacao: 'Pedido de pack via link de email. Módulos incluídos sem cobrança adicional.',
        });
        if (error) throw error;
        await service.from('administradores').update({ token_renovacao: null, token_renovacao_expira: null }).eq('id', admin.id);
        return json({ ok: true, mensagem: `Pedido de ${labelPack(escolhido)} recebido (${valor.toFixed(2)} €). Aguarda confirmação do Super Admin.` });
      }

      // renovar (mesmo plano) ou outro_plano (plano novo)
      const planoFinal = escolha === "renovar" ? lic?.plano : planoEscolhido;
      if (!planoFinal || !PLANOS[planoFinal]) return json({ erro: "Plano inválido." }, 400);

      await service.from("pedidos_renovacao").insert({
        id: crypto.randomUUID(),
        admin_id: admin.id,
        tipo: escolha === "renovar" ? "renovacao" : "alteracao",
        plano_atual: lic?.plano || null,
        plano_pedido: planoFinal,
        observacao: "Pedido submetido pelo cliente via link de email (aviso de licença).",
        status: "pendente",
        data_criacao: agora,
      });

      // add-ons opcionais, cada um como um pedido próprio (mesmo padrão usado dentro da app)
      const addonsPedidos: string[] = [];
      if (addons && typeof addons === "object") {
        for (const modulo of MODULOS_ADDON) {
          const periodo = addons[modulo as ModuloAddon];
          if (periodo !== "mensal" && periodo !== "anual") continue;
          await service.from("pedidos_renovacao").insert({
            id: crypto.randomUUID(),
            admin_id: admin.id,
            tipo: `${modulo === "contratos" ? "contrato" : modulo}_${periodo}`,
            plano_atual: null,
            plano_pedido: null,
            observacao: `Módulo ${modulo} (${periodo}) pedido junto com a renovação, via link de email.${modulo === "rondas" ? " (grátis, fase de lançamento)" : ""}`,
            status: "pendente",
            data_criacao: agora,
          });
          addonsPedidos.push(`${modulo} (${periodo})`);
        }
      }

      await service.from("administradores").update({ token_renovacao: null, token_renovacao_expira: null }).eq("id", admin.id);

      return json({
        ok: true,
        mensagem: `Pedido enviado com sucesso${addonsPedidos.length ? " (incluindo " + addonsPedidos.join(", ") + ")" : ""}. Aguarda a aprovação do Super Admin — vais receber um email de confirmação.`,
      });
    }

    return json({ erro: "Ação desconhecida: " + acao }, 400);
  } catch (e) {
    console.error("Erro em renovacao-cliente:", e);
    return json({ erro: String(e) }, 500);
  }
});
