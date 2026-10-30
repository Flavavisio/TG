// Catálogo partilhado pela comparação pública e pela alteração de pack na licença.
const PACK_FUNCS = [
    { grupo: 'Base', linhas: [
        ['Clientes', 1,1,1,1],
        ['Instalações do cliente', 1,1,1,1],
        ['Passaporte de Instalação', 0,1,1,1],
        ['Ordens de Serviço', 1,1,1,1],
        ['Folha de Obra / Intervenção', 1,1,1,1],
        ['PDF Folha de Obra — Cliente', 1,1,1,1],
        ['Manutenções', 1,1,1,1],
        ['Agenda de Obras (calendário de OS)', 1,1,1,1],
        ['Funcionários', 1,1,1,1],
        ['Calendário da equipa', 1,1,1,1],
        ['Relatórios personalizados', '5 modelos','15 modelos','40 modelos','Ilimitados'],
    ]},
    { grupo: 'Equipa no terreno', linhas: [
        ['Ponto / Assiduidade', 0,1,1,1],
        ['GPS nas picagens', 0,1,1,1],
        ['Férias e faltas', 0,1,1,1],
        ['Portal do Cliente', 0,1,1,1],
        ['Contratos de manutenção', 0,1,1,1],
        ['Frota', 0,1,1,1],
        ['Relatórios de especialidade', 0,'REX, RBI, RSI, RCM, RIE, RCP, CCTV, Intrusão','REX, RBI, RSI, RCM, RIE, RCP, CCTV, Intrusão','REX, RBI, RSI, RCM, RIE, RCP, CCTV, Intrusão'],
        ['Mapa da Equipa', 0,1,1,1],
        ['Painel TV', 0,1,1,1],
    ]},
    { grupo: 'Operação (obras, stock, assistências)', linhas: [
        ['Folha de Obra — Custos Internos', 0,0,1,1],
        ['Custos de mão de obra', 0,0,1,1],
        ['Custos dos materiais', 0,0,1,1],
        ['Obras', 0,0,1,1],
        ['Picagem entrada/saída em obra', 0,0,1,1],
        ['Stock / Artigos', 0,0,1,1],
        ['Armazéns', 0,0,1,1],
        ['Requisições', 0,0,1,1],
        ['Encomendas', 0,0,1,1],
        ['Fornecedores', 0,0,1,1],
        ['Ferramentas / QR', 0,0,1,1],
        ['Assistências', 0,0,1,1],
        ['Financeiro / Despesas', 0,0,1,1],
    ]},
    { grupo: 'Topo de gama', linhas: [
        ['CRM Comercial', 0,0,0,1],
        ['Dashboard Analítico', 0,0,0,1],
        ['Geofence / histórico GPS', 0,0,0,1],
        ['Opções de integração ERP (sujeitas a compatibilidade)', 0,0,0,1],
        ['Rondas / Vigilância', 0,0,0,1],
        ['Auditoria avançada', 0,0,0,1],
    ]},
];
const PACK_IDX = { express: 1, expert: 2, pro: 3, pro_plus: 3, supreme: 4 };

function tgPackFeatureValue(row, pack) {
    if (!Object.hasOwn(PACK_IDX, pack)) return 0;
    return pack === 'pro_plus' && row[0] === 'CRM Comercial' ? 1 : row[PACK_IDX[pack]];
}
function tgPackFeatureComparison(currentPack, selectedPack) {
    const compare = Object.hasOwn(PACK_IDX, currentPack);
    const rank = value => value === 'Ilimitados' ? Infinity : (parseInt(value, 10) || 0);
    return PACK_FUNCS.map(group => ({
        name: group.grupo,
        features: group.linhas.map(row => {
            const value = tgPackFeatureValue(row, selectedPack);
            const previous = tgPackFeatureValue(row, currentPack);
            let change = value ? 'same' : 'excluded';
            if (compare) {
                if (value && !previous) change = 'added';
                else if (!value && previous) change = 'removed';
                else if (value && previous && rank(value) > rank(previous)) change = 'increased';
                else if (value && previous && rank(value) < rank(previous)) change = 'reduced';
            }
            return { label: row[0], value, previous, change };
        }),
    }));
}
