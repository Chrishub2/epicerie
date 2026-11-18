// =====================================================================
// Console — vue « Magasins et références » : bannières, succursales, codes postaux.
// Même modèle que l'onglet Magasins du téléphone (objets `magasin` et `cp`) :
//   magasin = { id, banniere, nom, codePostal, adresse, lat, lng, actif? }   ·   cp = { code, libelle } (clé = code)
// Écritures (vraies données) seulement par ecrire_objet, source « console » : version contrôlée, historique,
// reçues en temps réel par les téléphones. Retirer = suppression douce (supprime = true), restaurable.
// =====================================================================
import { BANNIERES } from '../demo-data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const BANS = Object.entries(BANNIERES).filter(([, b]) => !b.enLigneSeulement);
const nomBan = (b) => BANNIERES[b]?.nom || b;
const pastille = (b) => `<span class="mg-ban" style="--c:${BANNIERES[b]?.couleur || '#888'}">${esc(nomBan(b))}</span>`;
const lienMaps = (m) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.adresse ? `${m.nom}, ${m.adresse}` : m.nom)}`;

const STYLE = `
.mg .defile { display: grid; gap: 16px; align-content: start; }
.mg-bans { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.mg-carte .badge { white-space: nowrap; margin-left: auto; }
.mg-carte { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--trait); border-radius: var(--rayon); background: var(--surface-2); }
.mg-carte .n { margin-left: auto; font: 12px var(--police-mono); color: var(--texte-3); }
.mg-carte.vide { border-color: var(--alerte); }
.mg-ban { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; white-space: nowrap; }
.mg-ban::before { content: ''; width: 10px; height: 10px; border-radius: 3px; background: var(--c); flex: none; }
.mg-rang { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.mg table input.champ { width: 100%; }
.mg td.ctr { text-align: center; }
.mg tr.inactif td { opacity: .55; }
.mg-cp { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 10px; border: 1px solid var(--trait); border-radius: 99px; margin: 0 6px 6px 0; }
.mg-res { display: grid; gap: 6px; margin-top: 10px; }
.mg-res > div { display: flex; gap: 10px; align-items: center; padding: 6px 10px; border: 1px solid var(--trait); border-radius: var(--rayon); }
.mg-res > div > span:first-child { flex: 1; min-width: 0; }
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
        <div class="mg-rang">
          <select class="champ" id="mgBan">${BANS.map(([k, b]) => `<option value="${k}" ${k === ui.ban ? 'selected' : ''}>${esc(b.nom)}</option>`).join('')}</select>
          <input class="champ" id="mgVille" placeholder="Ville ou code postal (ex. Varennes, J3X)" value="${esc(ui.ville)}">
          <button class="btn principal" id="mgChercher">🔎 Chercher</button>
          <button class="btn" id="mgMain">✎ Ajouter à la main</button></div>
        <div class="mg-res" id="mgRes">${ui.message ? `<p class="muet">${esc(ui.message)}</p>` : ''}${(ui.resultats || []).map((r, i) => `<div>
          <span><b>${esc(r.nom)}</b><br><span class="muet">${esc(r.adresse)}</span></span>
          ${E.magasins.some((m) => m.adresse === r.adresse) ? '<span class="badge ok">déjà ajoutée</span>' : `<button class="btn petit principal" data-ajres="${i}">Ajouter</button>`}</div>`).join('')}</div></div>

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

      <div class="panneau"><h2>Codes postaux</h2>
        <p class="muet" style="margin:0 0 10px">Les secteurs où tu magasines (le téléphone regroupe les magasins par code postal). Ajoutés automatiquement avec une succursale trouvée.</p>
        <div>${E.codesPostaux.map((c) => `<span class="mg-cp"><b class="mono">${esc(c.code)}</b> ${esc(c.libelle)} <button class="bouton-icone" data-supcp="${esc(c.code)}" title="Retirer">✕</button></span>`).join('') || '<span class="muet">Aucun.</span>'}</div>
        <div class="mg-rang" style="margin-top:6px"><input class="champ" id="mgCp" placeholder="Code (ex. J3H)" style="width:120px"><input class="champ" id="mgCpLib" placeholder="Ville"><button class="btn" id="mgCpAjout">Ajouter</button></div></div>

      <div class="panneau"><h2>Références marchand</h2><p class="muet" style="margin:0">À venir : noms imprimés sur les reçus et liens épiceries.ca par bannière.</p></div>
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

  async function ajouterMagasin(m) {
    m.codePostal = (m.codePostal || '').toUpperCase().slice(0, 3);
    if (E.magasins.some((x) => (m.adresse && x.adresse === m.adresse) || sansAccents(x.nom) === sansAccents(m.nom) && x.banniere === m.banniere)) {
      ctx.note('Déjà dans tes magasins.'); return;
    }
    await assurerCp(m.codePostal, m.ville);
    const propre = { id: uid('m'), banniere: m.banniere, nom: m.nom, codePostal: m.codePostal, adresse: m.adresse || '' };
    if (Number.isFinite(m.lat)) { propre.lat = m.lat; propre.lng = m.lng; }
    if (await ecrire('magasin', propre)) { E.magasins.push(propre); ctx.note(`${propre.nom} ajouté${ctx.reel ? ' (les téléphones le reçoivent tout de suite)' : ''}`); }
    ctx.rendre();
  }

  // ---------- branchements ----------
  $$('[data-ajban]').forEach((b) => b.onclick = () => {
    ui.ban = b.dataset.ajban; ui.resultats = null; ui.message = '';
    vueMagasins(t, ctx); t.querySelector('#mgTrouver')?.scrollIntoView({ behavior: 'smooth' }); t.querySelector('#mgVille')?.focus();
  });
  $('#mgBan').onchange = (ev) => { ui.ban = ev.target.value; };
  $('#mgVille').oninput = (ev) => { ui.ville = ev.target.value; };
  $('#mgVille').onkeydown = (ev) => { if (ev.key === 'Enter') $('#mgChercher').click(); };

  $('#mgChercher').onclick = async () => {
    ui.ban = $('#mgBan').value; ui.ville = $('#mgVille').value.trim();
    if (!ui.ville) { ctx.note('Entre une ville ou un code postal.'); return; }
    $('#mgRes').innerHTML = '<p class="muet">Recherche…</p>';
    let res = [];
    try { res = await chercherSuccursales(nomBan(ui.ban), ui.ville); } catch { ui.message = 'Recherche impossible (réseau). Réessaie ou ajoute à la main.'; ui.resultats = []; vueMagasins(t, ctx); return; }
    const estCode = /^[a-z]\d[a-z]/i.test(ui.ville);
    const meme = estCode ? res.filter((r) => r.fsa.toUpperCase() === ui.ville.slice(0, 3).toUpperCase()) : res.filter((r) => sansAccents(r.ville) === sansAccents(ui.ville));
    ui.message = !res.length ? 'Rien trouvé. Essaie une ville voisine, ou ajoute-la à la main.'
      : !meme.length ? `Aucune succursale exactement à ${ui.ville} ; voici les plus proches :` : '';
    ui.resultats = (meme.length ? meme : res).map((r) => ({ ...r, banniere: ui.ban }));
    vueMagasins(t, ctx);
  };
  $$('[data-ajres]').forEach((b) => b.onclick = () => {
    const r = ui.resultats[Number(b.dataset.ajres)];
    ajouterMagasin({ banniere: r.banniere, nom: `${nomBan(r.banniere)} ${r.ville || ''}`.trim(), codePostal: r.fsa, adresse: r.adresse, lat: r.lat, lng: r.lng, ville: r.ville });
  });
  $('#mgMain').onclick = () => {
    const ban = $('#mgBan').value;
    const ville = prompt(`Succursale ${nomBan(ban)} : ville ?`, $('#mgVille').value.trim()); if (!ville) return;
    const adresse = prompt('Adresse (facultatif, ex. 2020 boul. René-Gaultier, Varennes, QC J3X 1N9) :', '') || '';
    const cp = (prompt('Code postal (3 premiers caractères, ex. J3X) :', (adresse.match(/[A-Z]\d[A-Z]/i) || [''])[0].toUpperCase()) || '').trim();
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

  $('#mgCpAjout').onclick = async () => {
    const code = $('#mgCp').value.trim().toUpperCase().slice(0, 3);
    if (!/^[A-Z]\d[A-Z]$/.test(code)) { ctx.note('Code postal : 3 caractères, ex. J3H.'); return; }
    if (E.codesPostaux.some((c) => c.code === code)) { ctx.note('Déjà là.'); return; }
    await assurerCp(code, $('#mgCpLib').value.trim());
    ctx.rendre();
  };
  $$('[data-supcp]').forEach((b) => b.onclick = async () => {
    const code = b.dataset.supcp;
    if (E.magasins.some((m) => m.codePostal === code)) { ctx.note('Retire ou déplace d\'abord les magasins de ce code postal.'); return; }
    const c = E.codesPostaux.find((x) => x.code === code);
    if (c && await ecrire('cp', copie(c), true)) E.codesPostaux = E.codesPostaux.filter((x) => x.code !== code);
    ctx.rendre();
  });
}

/** Succursales d'une bannière près d'une ville / d'un code postal (OpenStreetMap Nominatim, 1 requête) — même règle que l'app. */
export async function chercherSuccursales(nomBanniere, ville) {
  const p = new URLSearchParams({ q: `${nomBanniere}, ${ville}, Québec`, format: 'jsonv2', addressdetails: 1, limit: 8, countrycodes: 'ca' });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`);
  const j = await r.json();
  const cle = sansAccents(nomBanniere).replace(/\s/g, '');
  return j.filter((x) => sansAccents(x.name || x.display_name).replace(/\s/g, '').includes(cle)).map((x) => {
    const a = x.address || {};
    const ville2 = a.city || a.town || a.village || a.municipality || '';
    const cp = (a.postcode || '').toUpperCase();
    const adresse = [[a.house_number, a.road].filter(Boolean).join(', '), ville2, cp ? `QC ${cp}` : 'QC'].filter(Boolean).join(', ');
    return { nom: x.name || nomBanniere, adresse, ville: ville2, fsa: cp.slice(0, 3) || ville2 || '?', lat: Number(x.lat), lng: Number(x.lon) };
  });
}
