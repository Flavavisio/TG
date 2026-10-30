# Pack Pro+

Pro+ = Pro + CRM Comercial, por mais 9,99 €/mês no mesmo escalão, IVA incluído. Preços até 5/10/25/50 funcionários: 82,48 / 87,48 / 102,48 / 142,48 €. Blocos de +5: 5 €/mês, até 100 funcionários. Anual = 12 mensalidades com 10% de desconto. Mantém os limites Pro (40 modelos/campos), sem ERP ou Rondas incluídos.

A aplicação, landing, planos e renovação pelo link de email usam estes valores. Os módulos incluídos não somam novamente ao preço do pack. Criação no Super Admin, confirmação de trial, aprovação e renovação aplicam explicitamente o pack, período e validade aos módulos incluídos. A aprovação não pode estender duas vezes o mesmo pedido. O trial é gratuito durante 14 dias, com os direitos do pack e a capacidade escolhida. Pedidos antigos por número de funcionários continuam compatíveis.

A gravação das definições de uma conta existente envia apenas os campos alterados, evitando que alterações de nome/atividade/logótipo reescrevam pack e validades em cache. A edição manual de vencimentos aguarda confirmação da gravação. Não existe reaplicação automática do pack no carregamento que anule uma data definida manualmente.

Backend: aplicar a migração `pack_pro_plus_trial`; publicar `confirmar-trial`, `criar_pedido_trial` e `renovacao-cliente` com a dependência `_shared/packs.ts`. Preservar `verify_jwt` de cada função (false/true/false respetivamente). Estes deployments não enviam emails; os testes usam respostas simuladas e domínios `.invalid`.

Validação: `NODE_PATH=<pasta com jsdom> node --test tests/pack-pro-plus.test.cjs tests/billing-selection.test.cjs tests/integrated-modules.test.cjs tests/assist-native.test.cjs`. Os testes exercitam preços, trial, pedidos, aprovação anual, duplicação, downgrade, expiração, direitos e renovação por email. O teste Nexus falha também no main anterior na expectativa de layout do encarregado; não resulta desta alteração. A validação visual Playwright exige Chromium; neste ambiente o download do executável falhou.
