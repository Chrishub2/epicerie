// =====================================================================
// Test de couverture des sources (v37)
// Pour chaque marque/format de ton catalogue qui a un code-barres, on demande à
// Open Food Facts, épiceries.ca et UPCitemdb s'ils le connaissent, et si la marque
// et le format concordent avec ta fiche. Résultat : une vraie mesure, sur TES produits,
// plutôt que les chiffres annoncés par les sites. Lecture seule : rien n'est modifié.
// =====================================================================
import * as S from './store.js';
import { $, esc, ouvrirModale, quandFermee, toast } from './ui.js';
import { gtinVariantes, formatLisible } from './normalise.js';
import * as P from './produits.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const SOURCES = ['off', 'ec', 'upc'];
const NOMS = { off: 'Open Food Facts', ec: 'épiceries.ca', upc: 'UPCitemdb' };

/** Marques/formats à tester : une entrée par variante active avec code (le code à 13 chiffres de préférence). */
function echantillon() {
  const e = S.get();
  return e.articles.flatMap((a) => P.variantesActives(a).filter((v) => v.codes?.length).map((v) => ({
    article: a.nom, marque: v.marque || '', format: v.format || '', libelle: P.libelleVariante(v),
    code: [...v.codes].sort((x, y) => Math.abs(x.length - 13) - Math.abs(y.length - 13))[0],
  })));
}

async function testerOFF(code) {
  for (const c of gtinVariantes(code)) {
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=product_name_fr,product_name,brands,quantity`);
      const j = await r.json();
      if (j.status === 1 && j.product) return { nom: j.product.product_name_fr || j.product.product_name || '', marque: (j.product.brands || '').split(',')[0].trim(), format: j.product.quantity || '' };
    } catch { return { erreur: true }; }
    await pause(700); // limite d'Open Food Facts
  }
  return null;
}

/** épiceries.ca : distingue « inconnu » (not_found) de « pas de réponse » (panne, délai). */
async function testerEC(code) {
  for (const c of gtinVariantes(code)) {
    try {
      const r = await fetch(`https://epiceries.ca/api?${new URLSearchParams({ endpoint: 'barcode', code: c })}`);
      const j = await r.json();
      if (j.ok && j.data?.product) { const p = j.data.product; return { nom: p.name || '', marque: p.brand || '', format: p.size || '', magasin: p.store || '' }; }
      if (!j.ok && j.error?.code !== 'not_found') return { erreur: true };
    } catch { return { erreur: true }; }
    await pause(400); // pas de rafales
  }
  return null;
}

async function testerUPC(code, Sync) {
  if (!Sync.estPret()) return { nonTeste: true };
  const d = await Sync.chercherCode(code);
  return d ? { nom: d.titre || '', marque: d.marque || '', format: '' } : null;
}

/** Concordance d'un résultat avec ta fiche : trouvé, marque exacte, format exact. */
function noter(res, item) {
  if (!res || res.erreur || res.nonTeste) return res;
  return { ...res, marqueOk: !!(item.marque && res.marque && P.memeMarque(item.marque, res.marque)),
    formatOk: !!(item.format && res.format && P.memeFormat(item.format, formatLisible(res.format) || res.format)) };
}

function resume(lignes) {
  const n = lignes.length;
  const stats = Object.fromEntries(SOURCES.map((s) => {
    const r = lignes.map((l) => l[s]);
    const testes = r.filter((x) => !x?.nonTeste && !x?.erreur).length;
    const trouves = r.filter((x) => x && !x.erreur && !x.nonTeste).length;
    const seul = lignes.filter((l) => l[s] && !l[s].erreur && !l[s].nonTeste && SOURCES.filter((o) => o !== s).every((o) => !l[o] || l[o].erreur || l[o].nonTeste)).length;
    return [s, { testes, trouves, marque: r.filter((x) => x?.marqueOk).length, format: r.filter((x) => x?.formatOk).length, seul }];
  }));
  const aucun = lignes.filter((l) => SOURCES.every((s) => !l[s] || l[s].erreur || l[s].nonTeste)).length;
  return { n, stats, aucun };
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');

function htmlResume(r) {
  return `<table class="comp"><tr><th style="text-align:left">Source</th><th>Trouvés</th><th>Marque ok</th><th>Format ok</th><th>Seule à trouver</th></tr>
    ${SOURCES.map((s) => { const x = r.stats[s]; return `<tr><td>${NOMS[s]}</td>
      <td>${x.testes ? `${x.trouves}/${x.testes}<br><span class="doux">${pct(x.trouves, x.testes)}</span>` : '<span class="doux">non testé</span>'}</td>
      <td>${x.trouves ? `${x.marque}/${x.trouves}` : '—'}</td><td>${x.trouves ? `${x.format}/${x.trouves}` : '—'}</td><td>${x.seul}</td></tr>`; }).join('')}
    </table><p class="doux">${r.n} marque(s)/format(s) testé(s) · <b>${r.aucun}</b> trouvé(s) nulle part. « Marque ok » / « Format ok » = concorde avec ta fiche (une fiche sans marque ou sans format ne peut pas concorder).</p>`;
}

function texteResume(r, lignes) {
  return [`Test de couverture — ${new Date().toLocaleDateString('fr-CA')} — ${r.n} marques/formats`,
    ...SOURCES.map((s) => { const x = r.stats[s]; return `${NOMS[s]} : ${x.testes ? `${x.trouves}/${x.testes} trouvés (${pct(x.trouves, x.testes)}), marque ok ${x.marque}, format ok ${x.format}, seule à trouver ${x.seul}` : 'non testé'}`; }),
    `Trouvés nulle part : ${r.aucun}`,
    ...lignes.filter((l) => SOURCES.every((s) => !l[s] || l[s].erreur || l[s].nonTeste)).map((l) => `  - ${l.article} · ${l.libelle} (${l.code})`)].join('\n');
}

export async function ouvrirCouverture() {
  const items = echantillon();
  const Sync = await import('./sync.js');
  let arret = false;
  ouvrirModale('Test de couverture des sources', `
    <p class="doux" style="margin-top:0">Je demande à chaque source si elle connaît tes produits scannés, et si la marque et le format concordent avec ta fiche. Lecture seule : rien n'est modifié.</p>
    ${items.length ? `<p><b>${items.length}</b> marque(s)/format(s) avec code-barres · environ ${Math.max(1, Math.round(items.length * 2.5 / 60))} min.</p>
      ${Sync.estPret() ? '' : '<div class="alerte">UPCitemdb passe par ton foyer : connecte-toi (Plus → Mon foyer) pour l\'inclure. Sinon il sera « non testé ».</div>'}
      <button class="btn" id="cvGo" style="width:100%">▶ Lancer le test</button>`
      : '<div class="alerte">Aucun produit n\'a encore de code-barres. Scanne tes produits (Catalogue → ▥ Scanner mes produits), puis reviens.</div>'}
    <div id="cvEtat" class="doux" style="margin-top:8px"></div><div id="cvRes"></div>`, (c) => {
    quandFermee(() => { arret = true; });
    $('#cvGo', c)?.addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      const lignes = [];
      for (const [i, it] of items.entries()) {
        if (arret) break;
        $('#cvEtat', c).textContent = `⏳ ${i + 1}/${items.length} · ${it.article} — ${it.libelle}`;
        // Chaque source a 15 s pour répondre ; sinon « ⚠️ pas de réponse » (le test continue)
        const limite = (p) => Promise.race([p, pause(15000).then(() => ({ erreur: true }))]);
        const [off, ec, upc] = await Promise.all([limite(testerOFF(it.code)), limite(testerEC(it.code)), limite(testerUPC(it.code, Sync))]);
        lignes.push({ ...it, off: noter(off, it), ec: noter(ec, it), upc: noter(upc, it) });
        await pause(500); // pas de rafales
      }
      if (!lignes.length) return;
      const r = resume(lignes);
      const marque = (x) => (!x ? '✗' : x.erreur ? '⚠️' : x.nonTeste ? '—' : `✓${x.marqueOk ? '' : ' <span class="doux">marque≠</span>'}${x.formatOk ? '' : ' <span class="doux">format≠</span>'}`);
      $('#cvEtat', c).textContent = arret ? `Arrêté après ${lignes.length} produit(s).` : '✓ Test terminé.';
      $('#cvRes', c).innerHTML = htmlResume(r) + `<button class="btn sec" id="cvCopie" style="width:100%;margin:6px 0">📋 Copier le résumé</button>
        <details><summary class="doux">Détail par produit</summary><table class="comp" style="font-size:12px"><tr><th style="text-align:left">Produit</th>${SOURCES.map((s) => `<th>${NOMS[s].split(' ')[0]}</th>`).join('')}</tr>
        ${lignes.map((l) => `<tr><td>${esc(l.article)}<div class="doux">${esc(l.libelle)}</div></td>${SOURCES.map((s) => `<td>${marque(l[s])}</td>`).join('')}</tr>`).join('')}</table></details>`;
      $('#cvCopie', c).onclick = async () => {
        try { await navigator.clipboard.writeText(texteResume(r, lignes)); toast('Résumé copié : colle-le à Claude'); } catch { toast('Copie impossible sur ce téléphone'); }
      };
    });
  });
}
