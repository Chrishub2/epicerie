// =====================================================================
// Console — vue « Magasins et références » : bannières, succursales, codes postaux.
// Même modèle que l'onglet Magasins du téléphone (objets `magasin` et `cp`) :
//   magasin = { id, banniere, nom, codePostal, adresse, lat, lng, actif? }   ·   cp = { code, libelle } (clé = code)
// Écritures (vraies données) seulement par ecrire_objet, source « console » : version contrôlée, historique,
// reçues en temps réel par les téléphones. Retirer = suppression douce (supprime = true), restaurable.
// =====================================================================
import { BANNIERES } from '../demo-data.js';
import { estFsa, fsaDe, secteurDe, villeAdresse, memeVille, enSecteur } from '../secteurs.js';
export { secteurDe, villeAdresse, memeVille, enSecteur };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const BANS = Object.entries(BANNIERES).filter(([, b]) => !b.enLigneSeulement);
const nomBan = (b) => BANNIERES[b]?.nom || b;
// Logos : mêmes pastilles que l'app (app/ui.js LOGOS + styles de app/index.html) ; autres bannières : couleur de la bannière.
const LOGOS = { iga: 'IGA', super_c: 'SUPER C', metro: 'metro', maxi: 'maxi', costco: 'COSTCO', jean_coutu: 'Jean Coutu', provigo: 'provigo', walmart: 'Walmart ✱' };
const pastille = (b) => LOGOS[b]
  ? `<span class="mg-logo mg-logo-${b}" title="${esc(nomBan(b))}">${esc(LOGOS[b])}</span>`
  : `<span class="mg-logo" style="background:${BANNIERES[b]?.couleur || '#666'};color:#fff" title="${esc(nomBan(b))}">${esc(nomBan(b))}</span>`;
const lienRecherche = (ban, ville) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ban} ${ville || ''} Québec`.replace(/\s+/g, ' '))}`;
const lienMaps = (m) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.adresse ? `${m.nom}, ${m.adresse}` : m.nom)}`;

const STYLE = `
.mg .defile { display: grid; gap: 16px; align-content: start; }
.mg-bans { display: grid; grid-template-columns: repeat(auto-fill, minmax(285px, 1fr)); gap: 8px; }
.mg-carte .badge { white-space: nowrap; margin-left: auto; flex: none; }
.mg-carte { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--trait); border-radius: var(--rayon); background: var(--surface-2); min-width: 0; overflow: hidden; }
.mg-carte > .mg-logo { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.mg-carte > .btn { flex: none; }
.mg-carte .n { margin-left: auto; font: 12px var(--police-mono); color: var(--texte-3); flex: none; }
.mg-logo { display: inline-block; font: 800 12px/1 system-ui, sans-serif; padding: 4px 7px; border-radius: 6px; letter-spacing: .02em; white-space: nowrap; vertical-align: middle; }
.mg-logo-iga { background: #d6001c; color: #fff; }
.mg-logo-super_c { background: #ffd200; color: #e30613; font-style: italic; }
.mg-logo-metro { background: #111; color: #fff; text-transform: lowercase; box-shadow: 0 0 0 1px #444 inset; }
.mg-logo-maxi { background: #ffe100; color: #111; border: 2px solid #e30613; padding: 2px 6px; }
.mg-logo-costco { background: #fff; color: #e31837; border-bottom: 3px solid #005daa; box-shadow: 0 0 0 1px #d5d9e0 inset; }
.mg-logo-jean_coutu { background: #003da5; color: #fff; font-weight: 700; }
.mg-logo-provigo { background: #e2231a; color: #fff; text-transform: lowercase; }
.mg-logo-walmart { background: #0071ce; color: #fff; }
.mg-carte.vide { border-color: var(--alerte); }
.mg-rang { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.mg table input.champ { width: 100%; }
.mg td.ctr { text-align: center; }
.mg td.nw, .mg td.nw * { white-space: nowrap; }
.mg tr.inactif td { opacity: .55; }
.mg-cp { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 10px; border: 1px solid var(--trait); border-radius: 99px; margin: 0 6px 6px 0; }
/* La zone prend la largeur de la rangée de recherche : « Ajouter » s'aligne sous « Ajouter à la main », pas au bord de l'écran. */
.mg-zone { display: inline-flex; flex-direction: column; gap: 10px; max-width: 100%; }
.mg-res { display: grid; gap: 6px; }
.mg-res:empty { display: none; }
.mg-zone > .mg-res, .mg-zone > .mg-tuile { width: 0; min-width: 100%; }   /* suivent la largeur de la rangée sans l'élargir */
.mg-tuile.accent { border-style: solid; border-color: var(--etiquette); }
.mg-tuile { display: grid; gap: 8px; padding: 10px 12px; border: 1px dashed var(--trait-fort); border-radius: var(--rayon); background: var(--surface-2); }
.mg-res > div { display: flex; gap: 10px; align-items: center; padding: 6px 10px; border: 1px solid var(--trait); border-radius: var(--rayon); }
.mg-res > div > span:first-child { flex: 1; min-width: 0; }
.mg-auto { margin-top: 10px; display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--etiquette); border-radius: var(--rayon); }
.mg-auto label { display: flex; gap: 10px; align-items: center; padding: 5px 8px; border: 1px solid var(--trait); border-radius: var(--rayon); cursor: pointer; }
.mg-auto label.deja { opacity: .55; cursor: default; }
.mg-auto label > * { flex: none; }
.mg-auto label > .txt { flex: 1; min-width: 0; }
.mg-auto .km { font: 12px var(--police-mono); color: var(--texte-3); white-space: nowrap; }
`;

/**
 * @param {HTMLElement} t zone de travail
 * @param {{ etat: () => object, reel: boolean, source: object|null, ecritures: () => Set, note: Function, rendre: Function }} ctx
 */
export function vueMagasins(t, ctx) {
  const E = ctx.etat();
  E.magasins ||= []; E.codesPostaux ||= []; E.rabaisPerso ||= [];
  const ui = (vueMagasins.ui ||= { ban: 'super_c', ville: '', resultats: null, message: '' });

  const mags = [...E.magasins].sort((a, b) => nomBan(a.banniere).localeCompare(nomBan(b.banniere), 'fr') || a.nom.localeCompare(b.nom, 'fr'));
  const actifs = (b) => E.magasins.filter((m) => m.banniere === b && m.actif !== false).length;
  const sans = BANS.filter(([k]) => !actifs(k)).length;

  t.innerHTML = `<style>${STYLE}</style><div class="mg" style="display:flex;flex-direction:column;height:100%">
    <div class="entete-vue"><h1>Magasins et références</h1>
      <span class="muet">${E.magasins.length} succursale(s) · ${BANS.length - sans}/${BANS.length} bannières couvertes${ctx.reel ? '' : ' · démo (rien n\'est écrit)'}</span></div>
    <div class="defile">
      <div class="panneau"><h2>Bannières</h2>
        <p class="muet" style="margin:0 0 10px">Une bannière <b>sans succursale active</b> ne compte pas dans Comparer, et ses rabais de circulaire ne s'affichent pas. Clique « + » pour en chercher une.</p>
        <div class="mg-bans">${BANS.map(([k]) => { const n = actifs(k); return `<div class="mg-carte ${n ? '' : 'vide'}">${pastille(k)}
          ${n ? `<span class="n">${n}</span>` : '<span class="badge alerte">sans succursale</span>'}
          <button class="btn petit" data-ajban="${k}" title="Chercher une succursale ${esc(nomBan(k))}">+</button></div>`; }).join('')}</div></div>

      <div class="panneau" id="mgTrouver"><h2>Trouver une succursale</h2>
        <p class="muet" style="margin:0 0 10px">Bannière + ville ou code postal : je cherche les succursales et leurs adresses (OpenStreetMap, 1 recherche par clic). Pas trouvée ? Ajoute-la à la main.</p>
        <div class="mg-zone">
        <div class="mg-rang">
          <select class="champ" id="mgBan">${BANS.map(([k, b]) => `<option value="${k}" ${k === ui.ban ? 'selected' : ''}>${esc(b.nom)}</option>`).join('')}</select>
          <input class="champ" id="mgVille" placeholder="Ville ou code postal (ex. Varennes, J3X)" value="${esc(ui.ville)}">
          <button class="btn principal" id="mgChercher">🔎 Chercher</button>
          <button class="btn" id="mgAuto" title="Toutes les bannières autour de cette ville : une liste à cocher">✨ Auto</button>
          <select class="champ" id="mgRayon" title="Rayon de la recherche Auto">${[10, 15, 25, 40].map((k) => `<option value="${k}" ${k === (ui.rayon || RAYON_KM) ? 'selected' : ''}>${k} km</option>`).join('')}</select>
          <button class="btn" id="mgMain">✎ Ajouter à la main</button></div>
        <div class="mg-res" id="mgRes">${ui.message ? `<p class="muet">${esc(ui.message)}</p>` : ''}${(ui.resultats || []).map((r, i) => `<div>
          <span><b>${esc(r.nom)}</b><br><span class="muet">${esc(r.adresse)}</span></span>${r.km != null ? `<span class="muet" style="white-space:nowrap">${r.km.toFixed(1).replace('.', ',')} km</span>` : ''}
          ${E.magasins.some((m) => m.adresse === r.adresse) ? '<span class="badge ok">déjà ajoutée</span>' : `<button class="btn petit principal" data-ajres="${i}">Ajouter</button>`}</div>`).join('')}</div>
        <div class="mg-tuile">
          <div class="mg-rang"><b>🗺️ Avec Google Maps</b>
            <a class="btn" id="mgGoogle" href="${esc(lienRecherche(nomBan(ui.ban), ui.ville))}" target="_blank" rel="noopener">Ouvrir la recherche dans Google Maps ↗</a></div>
          <p class="muet" style="margin:0">1. Ouvre la recherche, choisis le bon magasin. 2. Clique « Copier l'adresse » (ou copie le lien de la page). 3. Colle-la ici.</p>
          <div class="mg-rang"><input class="champ" id="mgCollage" placeholder="Colle l'adresse ou le lien Google Maps" style="flex:1">
            <button class="btn principal" id="mgCollerAjout">Ajouter ce lieu</button></div>
          <div id="mgCollageInfo" class="muet"></div>
        </div></div>
        ${blocAuto(ui.auto, E)}</div>

      <div class="panneau"><h2>Mes succursales <span class="muet" style="font-weight:400">(${mags.length})</span></h2>
        ${mags.length ? `<table class="mini-table"><thead><tr><th style="width:150px">Bannière</th><th>Nom</th><th>Adresse</th><th style="width:90px">Code postal</th><th style="width:90px" class="ctr" title="Décoché = ignoré dans les comparaisons, les listes et les paniers (pas supprimé)">Considéré</th><th style="width:170px"></th></tr></thead><tbody>
          ${mags.map((m) => `<tr class="${m.actif === false ? 'inactif' : ''}">
            <td>${pastille(m.banniere)}</td>
            <td><input class="champ" data-champ="nom" data-id="${esc(m.id)}" value="${esc(m.nom)}"></td>
            <td><input class="champ" data-champ="adresse" data-id="${esc(m.id)}" value="${esc(m.adresse || '')}" placeholder="Adresse"></td>
            <td><input class="champ mono" data-champ="codePostal" data-id="${esc(m.id)}" value="${esc(m.codePostal || '')}" style="text-transform:uppercase"></td>
            <td class="ctr"><input type="checkbox" data-actif="${esc(m.id)}" ${m.actif !== false ? 'checked' : ''}></td>
            <td><a class="btn petit" href="${lienMaps(m)}" target="_blank" rel="noopener">🗺️ Itinéraire</a> <button class="btn petit danger" data-retirer="${esc(m.id)}">Retirer</button></td></tr>`).join('')}
          </tbody></table>` : '<p class="muet">Aucune succursale. Commence par Super C (ta circulaire envoyée) avec « Trouver une succursale ».</p>'}</div>

      <div class="panneau"><h2>Secteurs</h2>
        <p class="muet" style="margin:0 0 10px">Où tu magasines. Une <b>ville</b> couvre toutes ses succursales, peu importe leur code postal ; un code postal (ex. J3H) reste possible. Le téléphone regroupe tes magasins par secteur.</p>
        <div>${E.codesPostaux.map((c) => `<span class="mg-cp">${estFsa(c.code) ? `<b class="mono">${esc(c.code)}</b> ${esc(c.libelle)}` : `<b>${esc(c.libelle || c.code)}</b>`} <span class="muet">· ${E.magasins.filter((m) => enSecteur(m, c)).length}</span> <button class="bouton-icone" data-supcp="${esc(c.code)}" title="Retirer">✕</button></span>`).join('') || '<span class="muet">Aucun.</span>'}</div>
        <div class="mg-rang" style="margin-top:6px"><input class="champ" id="mgCp" placeholder="Ville ou code postal (ex. Mont-Saint-Hilaire, J3H)" style="width:340px"><button class="btn" id="mgCpAjout">Ajouter</button></div></div>

      <div class="panneau"><h2>Références marchand</h2>${blocReferences(E)}</div>
    </div></div>`;

  // ---------- écriture ----------
  const ecrire = async (type, o, supprime = false) => {
    if (!ctx.reel) return true;
    const id = type === 'cp' ? o.code : o.id;
    try {
      const v = await ctx.source.ecrire(type, id, o, o._version ?? null, 'console', supprime);
      Object.defineProperty(o, '_version', { value: v, enumerable: false, writable: true, configurable: true });
      ctx.ecritures().add(`${id}:${v}`);   // écho temps réel de notre propre écriture : silencieux
      return true;
    } catch (err) {
      ctx.note(err.conflit ? 'Modifié ailleurs entre-temps : la page est rechargée avec la dernière version.' : `Non enregistré : ${err.message}`);
      return false;
    }
  };
  const copie = (o) => { const c = JSON.parse(JSON.stringify(o)); Object.defineProperty(c, '_version', { value: o._version ?? null, enumerable: false, writable: true, configurable: true }); return c; };
  const remplacer = (coll, cle, ancien, nouveau) => { const i = E[coll].findIndex((x) => x[cle] === ancien[cle]); if (i >= 0) E[coll][i] = nouveau; };
  const $ = (s) => t.querySelector(s);
  const $$ = (s) => [...t.querySelectorAll(s)];

  async function assurerCp(code, ville) {
    if (!code || E.codesPostaux.some((c) => c.code === code)) return;
    const c = { code, libelle: ville || code };
    if (await ecrire('cp', c)) E.codesPostaux.push(c);
  }

  /** Ajoute une succursale. seul = false : ajout en lot (pas de message ni de réaffichage). → true si ajoutée */
  async function ajouterMagasin(m, seul = true) {
    m.codePostal = (m.codePostal || '').toUpperCase().slice(0, 3);
    if (E.magasins.some((x) => (m.adresse && x.adresse === m.adresse) || sansAccents(x.nom) === sansAccents(m.nom) && x.banniere === m.banniere)) {
      if (seul) ctx.note('Déjà dans tes magasins.');
      return false;
    }
    await assurerCp(m.codePostal, m.ville);
    const propre = { id: uid('m'), banniere: m.banniere, nom: m.nom, codePostal: m.codePostal, adresse: m.adresse || '' };
    if (Number.isFinite(m.lat)) { propre.lat = m.lat; propre.lng = m.lng; }
    const ok = await ecrire('magasin', propre);
    if (ok) E.magasins.push(propre);
    if (seul) { if (ok) ctx.note(`${propre.nom} ajouté${ctx.reel ? ' (les téléphones le reçoivent tout de suite)' : ''}`); ctx.rendre(); }
    return ok;
  }

  // ---------- branchements ----------
  $$('[data-ajban]').forEach((b) => b.onclick = () => {
    ui.ban = b.dataset.ajban; ui.resultats = null; ui.message = '';
    vueMagasins(t, ctx); t.querySelector('#mgTrouver')?.scrollIntoView({ behavior: 'smooth' }); t.querySelector('#mgVille')?.focus();
  });
  $('#mgBan').onchange = (ev) => { ui.ban = ev.target.value; };
  $('#mgRayon').onchange = (ev) => { ui.rayon = Number(ev.target.value); };
  $('#mgVille').oninput = (ev) => { ui.ville = ev.target.value; };
  $('#mgVille').onkeydown = (ev) => { if (ev.key === 'Enter') $('#mgChercher').click(); };

  // Chercher : on situe la ville (abréviations comprises), puis la bannière dans un rayon de RAYON_CHERCHER km, triée par distance.
  $('#mgChercher').onclick = async () => {
    ui.ban = $('#mgBan').value; ui.ville = $('#mgVille').value.trim();
    if (!ui.ville) { ctx.note('Entre une ville ou un code postal.'); return; }
    $('#mgRes').innerHTML = '<p class="muet">Recherche…</p>';
    let res = [], centre = null;
    try {
      centre = await geocoder(ui.ville);
      res = centre ? await chercherAutour(nomBan(ui.ban), centre, RAYON_CHERCHER) : await chercherSuccursales(nomBan(ui.ban), ui.ville);
    } catch { ui.message = 'Recherche impossible (réseau). Réessaie, ou utilise Google Maps ci-dessous.'; ui.resultats = []; vueMagasins(t, ctx); return; }
    res.sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
    const memeVilleQue = res.filter((r) => memeVille(r.ville, ui.ville));
    ui.message = !res.length
      ? `OpenStreetMap ne connaît aucun ${nomBan(ui.ban)} à moins de ${RAYON_CHERCHER} km de ${ui.ville} (ses données sont incomplètes, surtout pour les pharmacies). Utilise « Avec Google Maps » juste en dessous.`
      : !memeVilleQue.length ? `Aucun ${nomBan(ui.ban)} trouvé exactement à ${ui.ville} dans OpenStreetMap ; voici les plus proches. S'il en existe un, utilise « Avec Google Maps » ci-dessous.` : '';
    ui.resultats = res.map((r) => ({ ...r, banniere: ui.ban }));
    ui.surligneGoogle = !memeVilleQue.length;
    vueMagasins(t, ctx);
    if (ui.surligneGoogle) t.querySelector('.mg-tuile')?.classList.add('accent');
  };
  $$('[data-ajres]').forEach((b) => b.onclick = () => {
    const r = ui.resultats[Number(b.dataset.ajres)];
    ajouterMagasin({ banniere: r.banniere, nom: `${nomBan(r.banniere)} ${r.ville || ''}`.trim(), codePostal: r.fsa, adresse: r.adresse, lat: r.lat, lng: r.lng, ville: r.ville });
  });
  // ---------- Auto : toutes les bannières autour de la ville, liste à cocher ----------
  $('#mgAuto').onclick = async () => {
    ui.ville = $('#mgVille').value.trim();
    if (!ui.ville) { ctx.note("Entre d'abord ta ville ou ton code postal (ex. Mont-Saint-Hilaire, J3H)."); $('#mgVille').focus(); return; }
    ui.rayon = Number($('#mgRayon').value) || RAYON_KM;
    const a = ui.auto = { lieu: ui.ville, rayon: ui.rayon, enCours: true, progres: `Je situe ${ui.ville}…`, liste: [], coches: new Set() };
    vueMagasins(t, ctx);
    const majProgres = (txt) => { a.progres = txt; const z = t.querySelector('#mgAutoProgres'); if (z) z.textContent = txt; };
    try {
      const centre = await geocoder(a.lieu);
      if (!centre) { a.enCours = false; a.progres = `Je ne trouve pas « ${a.lieu} ». Essaie le nom complet de la ville.`; vueMagasins(t, ctx); return; }
      const parAdresse = new Map();
      for (let i = 0; i < BANS.length; i++) {
        if (ui.auto !== a) return;                                  // une autre recherche a commencé
        const [k] = BANS[i];
        majProgres(`Recherche ${nomBan(k)} (${i + 1}/${BANS.length})…`);
        await pause(1100);                                          // règle d'OpenStreetMap : 1 recherche par seconde
        let res = [];
        try { res = await chercherAutour(nomBan(k), centre, a.rayon); } catch { /* bannière suivante */ }
        for (const r of res) {
          const avant = parAdresse.get(r.adresse);
          // Même magasin trouvé par deux bannières (Uniprix / Uniprix Santé) : on garde la plus précise
          if (!avant || nomBan(k).length > nomBan(avant.banniere).length) parAdresse.set(r.adresse, { ...r, banniere: k });
        }
      }
      a.liste = [...parAdresse.values()].sort((x, y) => x.km - y.km);
      a.progres = a.liste.length ? '' : `Aucune succursale trouvée à moins de ${a.rayon} km de ${a.lieu}. Essaie un rayon plus grand.`;
    } catch { a.progres = 'Recherche impossible (réseau). Réessaie dans un moment.'; }
    a.enCours = false;
    if (ui.auto === a) vueMagasins(t, ctx);
  };
  $$('[data-auto-i]').forEach((c) => c.onchange = () => {
    const i = Number(c.dataset.autoI);
    if (c.checked) ui.auto.coches.add(i); else ui.auto.coches.delete(i);
    const b = t.querySelector('#mgAutoAjout'); if (b) { b.textContent = `Ajouter la sélection (${ui.auto.coches.size})`; b.disabled = !ui.auto.coches.size; }
  });
  t.querySelector('#mgAutoTout')?.addEventListener('click', () => {
    const libres = ui.auto.liste.map((r, i) => (deja(E, r) ? -1 : i)).filter((i) => i >= 0);
    ui.auto.coches = ui.auto.coches.size === libres.length ? new Set() : new Set(libres);
    vueMagasins(t, ctx);
  });
  t.querySelector('#mgAutoFermer')?.addEventListener('click', () => { ui.auto = null; vueMagasins(t, ctx); });
  t.querySelector('#mgAutoAjout')?.addEventListener('click', async (ev) => {
    const choix = [...ui.auto.coches].map((i) => ui.auto.liste[i]).filter(Boolean);
    if (!choix.length) return;
    ev.target.disabled = true; ev.target.textContent = 'Ajout…';
    let n = 0;
    for (const r of choix) {
      if (await ajouterMagasin({ banniere: r.banniere, nom: `${nomBan(r.banniere)} ${r.ville || ''}`.trim(), codePostal: r.fsa, adresse: r.adresse, lat: r.lat, lng: r.lng, ville: r.ville }, false)) n++;
    }
    ui.auto.coches = new Set();
    ctx.note(`${n} succursale(s) ajoutée(s)${ctx.reel ? ' — les téléphones les reçoivent tout de suite' : ''}`);
    ctx.rendre();
  });

  // Google Maps : le lien suit la bannière et la ville choisies ; le lieu revient par copier-coller.
  const majLienGoogle = () => { $('#mgGoogle').href = lienRecherche(nomBan($('#mgBan').value), $('#mgVille').value.trim()); };
  $('#mgBan').addEventListener('change', majLienGoogle);
  $('#mgVille').addEventListener('input', majLienGoogle);
  $('#mgCollage').onkeydown = (ev) => { if (ev.key === 'Enter') $('#mgCollerAjout').click(); };
  $('#mgCollerAjout').onclick = () => {
    const info = $('#mgCollageInfo');
    const l = lireLieuGoogle($('#mgCollage').value);
    if (!l) { info.textContent = 'Colle d\'abord l\'adresse ou le lien copié dans Google Maps.'; return; }
    if (l.erreur) { info.textContent = l.erreur; return; }
    const ban = $('#mgBan').value;
    let ville = l.ville || $('#mgVille').value.trim();
    if (!ville || /^[a-z]\d[a-z]/i.test(ville)) ville = (prompt('Ville de cette succursale ?', '') || '').trim();
    if (!ville) { info.textContent = 'Il manque la ville.'; return; }
    ajouterMagasin({ banniere: ban, nom: `${nomBan(ban)} ${ville}`, codePostal: l.codePostal, adresse: l.adresse, ville, lat: l.lat, lng: l.lng });
  };

  $('#mgMain').onclick = () => {
    const ban = $('#mgBan').value;
    const ville = prompt(`Succursale ${nomBan(ban)} : ville ?`, $('#mgVille').value.trim()); if (!ville) return;
    const adresse = prompt('Adresse (facultatif, ex. 2020 boul. René-Gaultier, Varennes, QC J3X 1N9) :', '') || '';
    const cp = (adresse.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i) || [''])[0].toUpperCase().slice(0, 3);   // facultatif : tiré de l'adresse si elle en a un
    ajouterMagasin({ banniere: ban, nom: `${nomBan(ban)} ${ville.trim()}`, codePostal: cp, adresse: adresse.trim(), ville: ville.trim() });
  };

  $$('[data-champ]').forEach((inp) => inp.onchange = async () => {
    const m = E.magasins.find((x) => x.id === inp.dataset.id); if (!m) return;
    const champ = inp.dataset.champ;
    let v = inp.value.replace(/\s+/g, ' ').trim();
    if (champ === 'codePostal') v = v.toUpperCase().slice(0, 3);
    if (champ === 'nom' && !v) { ctx.note('Le nom ne peut pas être vide.'); inp.value = m.nom; return; }
    if ((m[champ] || '') === v) return;
    const n = copie(m); n[champ] = v;
    if (champ === 'codePostal') await assurerCp(v, '');
    if (await ecrire('magasin', n)) { remplacer('magasins', 'id', m, n); ctx.note('Succursale modifiée'); }
    ctx.rendre();
  });
  $$('[data-actif]').forEach((c) => c.onchange = async () => {
    const m = E.magasins.find((x) => x.id === c.dataset.actif); if (!m) return;
    const n = copie(m); n.actif = c.checked;
    if (await ecrire('magasin', n)) { remplacer('magasins', 'id', m, n); ctx.note(c.checked ? `${m.nom} : considéré` : `${m.nom} : ignoré (pas supprimé)`); }
    ctx.rendre();
  });
  $$('[data-retirer]').forEach((b) => b.onclick = async () => {
    const m = E.magasins.find((x) => x.id === b.dataset.retirer); if (!m) return;
    const rp = E.rabaisPerso.filter((r) => r.magasinId === m.id);
    if (!confirm(`Retirer ${m.nom} de tes magasins ?${rp.length ? `\nSes ${rp.length} rabais perso seront retirés aussi.` : ''}\n\nLes prix déjà relevés sont gardés. Restaurable depuis l'historique.`)) return;
    if (!(await ecrire('magasin', copie(m), true))) { ctx.rendre(); return; }
    for (const r of rp) await ecrire('rabais', copie(r), true);
    E.magasins = E.magasins.filter((x) => x.id !== m.id);
    E.rabaisPerso = E.rabaisPerso.filter((r) => r.magasinId !== m.id);
    ctx.note(`${m.nom} retiré`); ctx.rendre();
  });

  $$('[data-creer-ref]').forEach((b) => b.onclick = () => {
    const g = magasinsDesRecus(E)[Number(b.dataset.creerRef)]; if (!g) return;
    const ville = villeAdresse(g.adresse) || prompt('Ville de ce magasin ?', '') || '';
    if (!ville.trim()) return;
    ajouterMagasin({ banniere: g.banniere, nom: `${nomBan(g.banniere)} ${ville.trim()}`, codePostal: fsaDe(g.adresse), adresse: g.adresse || '', ville: ville.trim() });
  });
  $('#mgCp').onkeydown = (ev) => { if (ev.key === 'Enter') $('#mgCpAjout').click(); };
  $('#mgCpAjout').onclick = async () => {
    const s = secteurDe($('#mgCp').value);
    if (!s) { ctx.note('Entre une ville (ex. Mont-Saint-Hilaire) ou un code postal (ex. J3H).'); return; }
    if (E.codesPostaux.some((c) => c.code === s.code || (!estFsa(c.code) && memeVille(c.code, s.code)))) { ctx.note('Ce secteur est déjà là.'); return; }
    await assurerCp(s.code, s.libelle);
    ctx.rendre();
  };
  $$('[data-supcp]').forEach((b) => b.onclick = async () => {
    const code = b.dataset.supcp;
    const c = E.codesPostaux.find((x) => x.code === code);
    if (c && E.magasins.some((m) => enSecteur(m, c))) { ctx.note('Retire ou déplace d\'abord les magasins de ce secteur.'); return; }
    if (c && await ecrire('cp', copie(c), true)) E.codesPostaux = E.codesPostaux.filter((x) => x.code !== code);
    ctx.rendre();
  });
}

const RAYON_KM = 15;
const RAYON_CHERCHER = 8;   // « Chercher » : une bannière autour de la ville
/** « 2026-11-15 » → « 15 nov. 2026 » (un seul bloc, jamais coupé). */
const dateCourte = (iso) => { const d = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Date(`${iso}T12:00:00`) : null;
  return d ? esc(d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' })) : esc(iso || ''); };
/** Magasins imprimés sur les reçus (en-tête : nom, adresse, téléphone), regroupés. */
export function magasinsDesRecus(E) {
  const grp = new Map();
  for (const r of E.recus || []) {
    if (r.supprime || !r.banniere) continue;
    const k = `${r.banniere}|${sansAccents(r.magasin)}|${sansAccents(r.adresse)}`;
    const g = grp.get(k) || { banniere: r.banniere, nom: r.magasin || '', adresse: r.adresse || '', telephone: r.telephone || '',
      programme: /^[\p{L}+ &'-]{2,30}$/u.test(r.programmeFidelite || '') ? r.programmeFidelite : '', n: 0, dernier: '' };
    g.n++;
    if ((r.date || '') > g.dernier) g.dernier = r.date || '';
    grp.set(k, g);
  }
  return [...grp.values()].sort((a, b) => nomBan(a.banniere).localeCompare(nomBan(b.banniere), 'fr'));
}

/** Noms imprimés sur les reçus → produit relié, par bannière. Lecture seule (les reçus ne sont jamais modifiés ici). */
export function nomsImprimes(E) {
  const arts = new Map((E.articles || []).map((a) => [a.id, a]));
  const parBan = new Map();
  for (const r of E.recus || []) {
    if (r.supprime || !r.banniere) continue;
    const m = parBan.get(r.banniere) || new Map();
    for (const l of r.lignes || []) {
      const lib = String(l.libelle || '').trim();
      if (!lib) continue;
      const k = sansAccents(lib);
      const x = m.get(k) || { libelle: lib, fois: 0, prix: null, date: '', produit: null, clair: l.nomClair || '' };
      x.fois++;
      if ((r.date || '') >= x.date) { x.date = r.date || ''; x.prix = l.prix ?? x.prix; }
      if (l.articleId && arts.get(l.articleId)) x.produit = arts.get(l.articleId).nom;
      m.set(k, x);
    }
    parBan.set(r.banniere, m);
  }
  return [...parBan.entries()].map(([banniere, m]) => ({ banniere, noms: [...m.values()].sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr')) }));
}

/** Section « Références marchand » : magasins vus sur les reçus + noms imprimés reliés aux produits. */
export function blocReferences(E) {
  const mags = magasinsDesRecus(E);
  if (!mags.length) return '<p class="muet" style="margin:0">Aucun reçu enregistré pour l\'instant. Chaque reçu lu (Plus → Mes reçus) remplira cette section.</p>';
  const lien = (g) => E.magasins.find((m) => m.banniere === g.banniere && fsaDe(g.adresse) && m.codePostal === fsaDe(g.adresse)
    && (memeVille(villeAdresse(m.adresse), villeAdresse(g.adresse)) || m.adresse === g.adresse))
    || E.magasins.find((m) => m.banniere === g.banniere && fsaDe(g.adresse) && m.codePostal === fsaDe(g.adresse));
  const tableMags = `<h3 style="margin:0 0 6px">Magasins vus sur tes reçus</h3>
    <table class="mini-table"><thead><tr><th style="width:120px">Bannière</th><th>Nom imprimé</th><th>Adresse imprimée</th><th style="width:110px">Téléphone</th><th style="width:130px">Reçus</th><th style="width:230px">Ta succursale</th></tr></thead><tbody>
    ${mags.map((g, i) => { const m = lien(g); return `<tr><td>${pastille(g.banniere)}</td><td><b>${esc(g.nom)}</b>${g.programme ? ` <span class="badge">${esc(g.programme)}</span>` : ''}</td>
      <td>${esc(g.adresse)}</td><td class="mono">${esc(g.telephone)}</td><td class="nw">${g.n} <span class="muet">· ${dateCourte(g.dernier)}</span></td>
      <td>${m ? `${esc(m.nom)} <span class="muet">(même code postal)</span>` : `<button class="btn petit principal" data-creer-ref="${i}">+ Créer cette succursale</button>`}</td></tr>`; }).join('')}
    </tbody></table>`;
  const groupes = nomsImprimes(E).map(({ banniere, noms }) => {
    const relies = noms.filter((x) => x.produit).length;
    return `<details style="margin-top:12px"><summary><b>Noms imprimés — ${esc(nomBan(banniere))}</b> <span class="muet">${noms.length} nom(s) · ${relies} relié(s) à un produit</span></summary>
      <table class="mini-table" style="margin-top:6px"><thead><tr><th>Nom imprimé sur le reçu</th><th>Produit relié</th><th style="width:70px">Fois</th><th style="width:170px">Dernier prix</th></tr></thead><tbody>
      ${noms.map((x) => `<tr><td class="mono">${esc(x.libelle)}</td><td>${x.produit ? esc(x.produit) : `<span class="muet">${esc(x.clair || '—')} · non relié</span>`}</td>
        <td>${x.fois}</td><td class="nw"><span class="mono">${x.prix != null ? `${Number(x.prix).toFixed(2).replace('.', ',')} $` : '—'}</span> <span class="muet">${dateCourte(x.date)}</span></td></tr>`).join('')}
      </tbody></table></details>`;
  }).join('');
  return tableMags + groupes + '<p class="muet" style="margin:10px 0 0">Lecture seule : pour relier un nom à un autre produit, ouvre le reçu (Plus → Mes reçus) sur le téléphone.</p>';
}
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const deja = (E, r) => E.magasins.some((m) => m.adresse === r.adresse);

/** Bloc des suggestions « Auto » (cases à cocher, triées par distance). */
function blocAuto(a, E) {
  if (!a) return '';
  const tete = `<div class="mg-rang"><b>✨ Autour de ${esc(a.lieu)}</b>
    ${a.enCours ? `<span class="muet" id="mgAutoProgres">${esc(a.progres)}</span>` : `<span class="muet">${a.liste.length} succursale(s) à moins de ${a.rayon} km</span>`}
    <span style="flex:1"></span>
    ${!a.enCours && a.liste.length ? `<button class="btn petit" id="mgAutoTout">Tout cocher / décocher</button>
      <button class="btn petit principal" id="mgAutoAjout" ${a.coches.size ? '' : 'disabled'}>Ajouter la sélection (${a.coches.size})</button>` : ''}
    <button class="btn petit" id="mgAutoFermer">Fermer</button></div>`;
  if (a.enCours || !a.liste.length) return `<div class="mg-auto">${tete}${!a.enCours && a.progres ? `<p class="muet" style="margin:0">${esc(a.progres)}</p>` : ''}</div>`;
  return `<div class="mg-auto">${tete}${a.liste.map((r, i) => {
    const d = deja(E, r);
    return `<label class="${d ? 'deja' : ''}"><input type="checkbox" data-auto-i="${i}" ${d ? 'disabled' : a.coches.has(i) ? 'checked' : ''}>
      ${pastille(r.banniere)}<span class="txt"><b>${esc(r.nom)}</b> <span class="muet">${esc(r.adresse)}</span></span>
      ${d ? '<span class="badge ok">déjà ajoutée</span>' : ''}<span class="km">${r.km.toFixed(1).replace('.', ',')} km</span></label>`;
  }).join('')}</div>`;
}

/** Distance en km entre deux points { lat, lng } (formule de haversine). */
export function distanceKm(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Ville ou code postal → { lat, lng } (OpenStreetMap, 1 requête). */
async function geocoder(lieu) {
  // « mont st-hilaire » n'est pas trouvé tel quel : on essaie aussi « Mont-Saint-Hilaire »
  const essais = [...new Set([developperVille(lieu), lieu])];
  for (const q of essais) {
    const p = new URLSearchParams({ q: `${q}, Québec`, format: 'jsonv2', limit: 1, countrycodes: 'ca' });
    const j = await (await fetch(`https://nominatim.openstreetmap.org/search?${p}`)).json();
    if (j[0]) return { lat: Number(j[0].lat), lng: Number(j[0].lon) };
  }
  return null;
}

/** « mont st-hilaire » → « Mont-Saint-Hilaire », « ste julie » → « Sainte-Julie ». Un code postal reste tel quel. */
export function developperVille(t) {
  const x = String(t ?? '').trim();
  if (/^[a-z]\d[a-z]/i.test(x)) return x.toUpperCase();
  return x.toLowerCase()
    .replace(/\bste?\b\.?/g, (m) => (m.startsWith('ste') ? 'sainte' : 'saint'))
    .split(/[\s-]+/).filter(Boolean)
    .map((w) => (['de', 'du', 'des', 'la', 'le', 'sur', 'en'].includes(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join('-');
}

/** Résultat OpenStreetMap → succursale ; null si ce n'est pas un commerce de cette bannière (ex. station de métro). */
export function versSuccursale(x, nomBanniere) {
  const cle = sansAccents(nomBanniere).replace(/\s/g, '');
  if (!sansAccents(x.name || x.display_name).replace(/\s/g, '').includes(cle)) return null;
  if (x.category && !['shop', 'amenity'].includes(x.category)) return null;
  const a = x.address || {};
  const ville = a.city || a.town || a.village || a.municipality || '';
  const cp = (a.postcode || '').toUpperCase();
  const adresse = [[a.house_number, a.road].filter(Boolean).join(', '), ville, cp ? `QC ${cp}` : 'QC'].filter(Boolean).join(', ');
  return { nom: x.name || nomBanniere, adresse, ville, fsa: cp.slice(0, 3) || ville || '?', lat: Number(x.lat), lng: Number(x.lon) };
}

/** Succursales d'une bannière dans un carré de ±RAYON_KM autour du centre, avec leur distance (OpenStreetMap, 1 requête). */
async function chercherAutour(nomBanniere, c, km = RAYON_KM) {
  const dLat = km / 111, dLng = km / (111 * Math.cos(c.lat * Math.PI / 180));
  const p = new URLSearchParams({ q: nomBanniere, format: 'jsonv2', addressdetails: 1, limit: 15, countrycodes: 'ca', bounded: 1,
    viewbox: `${c.lng - dLng},${c.lat + dLat},${c.lng + dLng},${c.lat - dLat}` });
  const j = await (await fetch(`https://nominatim.openstreetmap.org/search?${p}`)).json();
  return j.map((x) => versSuccursale(x, nomBanniere)).filter(Boolean)
    .map((r) => ({ ...r, km: distanceKm(c, r) })).filter((r) => r.km <= km);
}

/**
 * Lieu collé depuis Google Maps → { adresse, ville, codePostal (3 car.), lat?, lng? } | { erreur } | null.
 * Accepte l'adresse copiée (« 2020 Bd René-Gaultier, Varennes, QC J3X 1N9 », avec ou sans le nom du magasin
 * sur la 1re ligne) ou le lien d'une fiche (…/maps/place/Super+C,+2020+…/@45.68,-73.43,17z…).
 * Les liens courts (maps.app.goo.gl) ne se lisent pas sans serveur : on demande l'adresse.
 */
export function lireLieuGoogle(texte) {
  let t = String(texte ?? '').trim();
  if (!t) return null;
  let lat, lng;
  if (/^https?:\/\//i.test(t)) {
    let u;
    try { u = new URL(t); } catch { return { erreur: 'Lien illisible : colle plutôt l\'adresse.' }; }
    if (/(^|\.)goo\.gl$|maps\.app/.test(u.hostname)) return { erreur: 'Lien court : dans Google Maps, clique plutôt « Copier l\'adresse » et colle-la ici.' };
    const place = u.pathname.match(/\/place\/([^/]+)/);
    const brut = place ? decodeURIComponent(place[1].replace(/\+/g, ' ')) : (u.searchParams.get('query') || u.searchParams.get('q') || '');
    const at = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (at) { lat = Number(at[1]); lng = Number(at[2]); }
    t = brut;
  }
  // Nom du magasin sur la 1re ligne, ou en tête (« Super C, 2020 Bd… ») : on garde seulement l'adresse
  let parts = t.replace(/\r?\n+/g, ', ').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1 && !/\d/.test(parts[0])) parts = parts.slice(1);
  const adresse = parts.join(', ');
  const cp = (adresse.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i) || [''])[0].toUpperCase();
  const iQc = parts.findIndex((p) => /^(QC|Qu[ée]bec)\b/i.test(p));
  const ville = iQc > 0 ? parts[iQc - 1] : '';
  if (!/\d/.test(adresse)) return { erreur: 'Ce lien ne contient pas l\'adresse : clique « Copier l\'adresse » dans Google Maps.' };
  return { adresse, ville, codePostal: cp.slice(0, 3), lat, lng };
}

/** Succursales d'une bannière près d'une ville / d'un code postal (OpenStreetMap Nominatim, 1 requête) — même règle que l'app. */
export async function chercherSuccursales(nomBanniere, ville) {
  const p = new URLSearchParams({ q: `${nomBanniere}, ${ville}, Québec`, format: 'jsonv2', addressdetails: 1, limit: 8, countrycodes: 'ca' });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`);
  return (await r.json()).map((x) => versSuccursale(x, nomBanniere)).filter(Boolean);
}
