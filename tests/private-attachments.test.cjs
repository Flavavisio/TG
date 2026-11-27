const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criar } = require('../tg-anexos.js');

const base = 'https://projeto.example.invalid';
const novo = base + '/storage/v1/object/public/anexos-privados/empresa/os_fotos/os1/foto.jpeg';
const antigo = base + '/storage/v1/object/public/ficheiros/requisicoes/anexo.pdf';

test('interpreta anexos do projeto e preserva links externos e logótipos', () => {
    const anexos = criar({}, base);
    assert.deepEqual(anexos.referencia(novo), { bucket: 'anexos-privados', caminho: 'empresa/os_fotos/os1/foto.jpeg' });
    assert.deepEqual(anexos.referencia(antigo), { bucket: 'ficheiros', caminho: 'requisicoes/anexo.pdf' });
    assert.equal(anexos.referencia(novo.replace('projeto.', 'outro.')), null);
    assert.equal(anexos.referencia(novo.replace('/empresa/', '/empresa/../')), null);
    assert.equal(anexos.referencia(novo.replace('/empresa/', '/%65mpresa/')), null);
    assert.equal(anexos.referencia(novo.replace('anexos-privados', 'logotipos')), null);
});

test('resolve apenas com permissão de Storage, sem substituir a referência original', async () => {
    const chamadas = [];
    const supa = { storage: { from(bucket) {
        return { async createSignedUrl(caminho, segundos) {
            chamadas.push({ bucket, caminho, segundos });
            return caminho.endsWith('.pdf') ? { error: new Error('Sem permissão') } : { data: { signedUrl: base + '/temporario' } };
        } };
    } } };
    const anexos = criar(supa, base);
    assert.equal(await anexos.assinar(novo), base + '/temporario');
    assert.equal(await anexos.assinar('https://externo.example.invalid/logo.png'), 'https://externo.example.invalid/logo.png');
    await assert.rejects(anexos.assinar(antigo), /Não foi possível abrir este anexo/);
    assert.deepEqual(chamadas, [
        { bucket: 'anexos-privados', caminho: 'empresa/os_fotos/os1/foto.jpeg', segundos: 60 },
        { bucket: 'ficheiros', caminho: 'requisicoes/anexo.pdf', segundos: 60 },
    ]);
    assert.equal(anexos.referencia(novo).caminho, 'empresa/os_fotos/os1/foto.jpeg');
});

test('descarrega anexos via Storage autenticado e mantém a falha de autorização', async () => {
    const supa = { storage: { from(bucket) {
        return { async download(caminho) {
            assert.equal(bucket, 'ficheiros');
            if (caminho.endsWith('anexo.pdf')) return { data: new Blob(['ficheiro fictício'], { type: 'application/pdf' }) };
            return { error: new Error('Sem permissão') };
        } };
    } } };
    const anexos = criar(supa, base);
    const resposta = await anexos.descarregar(antigo);
    assert.equal(resposta.headers.get('Content-Type'), 'application/pdf');
    assert.equal(await resposta.text(), 'ficheiro fictício');
    await assert.rejects(anexos.descarregar(antigo.replace('anexo.pdf', 'outro.pdf')), /Não foi possível descarregar/);
});
