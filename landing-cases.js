/* Publish detailed cases only after factual review and customer publication approval.
 * Add a record with: approved: true, company, problem, use, result, source,
 * publicationApproval, and optional quote/author. Never infer business results.
 */
window.TG_CLIENT_CASES = window.TG_CLIENT_CASES || [];
(() => {
 'use strict';
 const section = document.querySelector('[data-real-cases]');
 if (!section) return;
 const valid = window.TG_CLIENT_CASES.filter(c => c.approved === true &&
  ['company','problem','use','result','source','publicationApproval'].every(k => typeof c[k] === 'string' && c[k].trim()));
 const list = section.querySelector('[data-real-cases-list]');
 valid.forEach(c => {
  const article = document.createElement('article'); article.className = 'tg-real-case';
  const heading = document.createElement('h3'); heading.textContent = c.company; article.append(heading);
  [['O desafio',c.problem],['Como utiliza a Total Gest',c.use],['O resultado',c.result]].forEach(([label,value]) => {
   const p = document.createElement('p'), b = document.createElement('strong');
   b.textContent = label + ': '; p.append(b,document.createTextNode(value)); article.append(p);
  });
  if (c.quote && c.author) {
   const q = document.createElement('blockquote'); q.textContent = c.quote;
   const author = document.createElement('p'); author.textContent = c.author; article.append(q,author);
  }
  list.append(article);
 });
 section.hidden = valid.length === 0;
})();
