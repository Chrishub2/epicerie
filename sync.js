// =====================================================================
// Partage entre les téléphones du foyer (Supabase)
// - Connexion par courriel : code à 6 chiffres (fiable dans l'app installée) ou lien.
// - Foyer : créer, ou joindre avec un code d'invitation.
// - Synchronisation élément par élément (articles, liste, prix…) dans la table
//   `objets`, en temps réel. Le plus récent gagne, élément par élément.
// - Photos sauvegardées dans le stockage privé du foyer ; possibilité de les retirer
//   du téléphone (elles sont retéléchargées au besoin).
// Sans connexion ou sans réseau, l'app fonctionne comme avant ; tout est envoyé au retour.
// =====================================================================
import * as S from './store.js';
import { toast } from './ui.js';
import { SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, SUPABASE_JS } from './config.js';
import { envoyerParPaquets } from './envoi.js';

// type d'objet en base → collection de l'état local
const COLLECTIONS = {
  article: 'articles', liste: 'liste', prix: 'prix', magasin: 'magasins', rayon: 'rayons',
  recette: 'recettes', livre: 'livres', carte: 'cartes', point: 'points', rabais: 'rabaisPerso',
  photo: 'photos', recu: 'recus', releve: 'releves', cp: 'codesPostaux', alerte: 'alertes',
  banniere: 'bannieres',   // registre de bannières (extension Flipp 1.5), lu seulement
};
const cleDe = (type, o) => (type === 'cp' ? o.code : o.id);
// Réglages partagés du foyer (un seul objet)
const REGLAGES = ['ordreRayons', 'rayonsJoints', 'optim'];
const META = 'epicerie-sync'; // { foyerId, empreintes: { 'type:id': json } }

let sb = null;          // client Supabase
let session = null;
let foyer = null;       // { id, nom, code_invitation }
let membres = [];
let canal = null;
let minuterie = null;
let enEnvoi = false;
let meta = lireMeta();
const ecouteurs = new Set();

function lireMeta() { try { return JSON.parse(localStorage.getItem(META)) || { empreintes: {} }; } catch { return { empreintes: {} }; } }
function ecrireMeta() { try { localStorage.setItem(META, JSON.stringify(meta)); } catch { /* plein */ } }
function signaler() { ecouteurs.forEach((f) => f(etatSync())); }

export function surChangement(fn) { ecouteurs.add(fn); return () => ecouteurs.delete(fn); }
export function etatSync() {
  return { connecte: !!session, courriel: session?.user?.email || null, foyer, membres, dernier: meta.dernier || null, enLigne: navigator.onLine, recuperation,
    refuses: meta.refuses || [], erreurEnvoi: meta.erreurEnvoi || null };
}
export function finRecuperation() { recuperation = false; signaler(); }
export function client() { return sb; }
export function estPret() { return !!(sb && session && foyer); }

// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------
export async function initialiser() {
  try {
    const { createClient } = await import(SUPABASE_JS);
    sb = createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  } catch {
    return; // hors ligne au premier lancement : on réessaiera plus tard
  }
  S.brancherTelechargement(telechargerPhoto);
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((evenement, s) => {
    const avant = session?.user?.id;
    session = s;
    if (evenement === 'PASSWORD_RECOVERY') recuperation = true;
    if (s?.user?.id !== avant) demarrer();
    signaler();
  });
  await demarrer();
  window.addEventListener('online', () => { if (estPret()) { tirer().then(pousser); } signaler(); });
  window.addEventListener('offline', signaler);
}

async function demarrer() {
  if (canal) { sb.removeChannel(canal); canal = null; }
  foyer = null; membres = [];
  if (!session) { signaler(); return; }
  const { data: m } = await sb.from('membres').select('foyer_id, nom_affiche, foyers(id, nom, code_invitation)').eq('user_id', session.user.id).limit(1);
  if (!m?.length) { signaler(); return; }
  foyer = m[0].foyers;
  if (meta.foyerId !== foyer.id) { meta = { foyerId: foyer.id, empreintes: {} }; ecrireMeta(); }
  await chargerMembres();
  S.maj((e) => { e.utilisateur = m[0].nom_affiche; e.demo = false; });
  await tirer();
  await pousser();
  ecouterTempsReel();
  if (!abonne) { S.abonner(() => planifierEnvoi()); abonne = true; }
  signaler();
}
let abonne = false;

async function chargerMembres() {
  const { data } = await sb.from('membres').select('nom_affiche, user_id').eq('foyer_id', foyer.id);
  membres = data || [];
  S.maj((e) => { e.membres = membres.map((x) => x.nom_affiche); });
}

// ---------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------
// Connexion par courriel + mot de passe (fonctionne dans l'app installée sur iPhone ;
// le forfait gratuit de Supabase ne permet pas d'ajouter un code dans le courriel).
const retourApp = () => location.origin + location.pathname;

/** Crée le compte. Retourne true si un courriel de confirmation a été envoyé. */
export async function creerCompte(courriel, motDePasse) {
  if (!sb) throw new Error('Pas de réseau');
  const { data, error } = await sb.auth.signUp({ email: courriel, password: motDePasse, options: { emailRedirectTo: retourApp() } });
  if (error) throw error;
  return !data.session; // pas de session = confirmation par courriel requise
}

export async function connecter(courriel, motDePasse) {
  if (!sb) throw new Error('Pas de réseau');
  const { error } = await sb.auth.signInWithPassword({ email: courriel, password: motDePasse });
  if (error) throw error;
}

export async function motDePasseOublie(courriel) {
  if (!sb) throw new Error('Pas de réseau');
  const { error } = await sb.auth.resetPasswordForEmail(courriel, { redirectTo: retourApp() });
  if (error) throw error;
}

export async function changerMotDePasse(motDePasse) {
  const { error } = await sb.auth.updateUser({ password: motDePasse });
  if (error) throw error;
}

/** Vrai quand on arrive par le lien « mot de passe oublié » : l'app demande le nouveau mot de passe. */
export let recuperation = false;

export async function deconnecter() {
  await sb.auth.signOut();
  meta = { empreintes: {} }; ecrireMeta();
}

// ---------------------------------------------------------------------
// Foyer
// ---------------------------------------------------------------------
/** Crée le foyer. garderDonnees=false : on part d'un état vide (sans la démo). */
export async function creerFoyer(nomFoyer, prenom, garderDonnees) {
  if (!garderDonnees) {
    S.maj((e) => {
      for (const c of ['articles', 'liste', 'prix', 'recettes', 'livres', 'cartes', 'points', 'photos', 'recus', 'releves', 'alertes']) e[c] = [];
      e.fileAttente = [];
    });
  }
  const { error } = await sb.rpc('creer_foyer', { p_nom: nomFoyer, p_nom_affiche: prenom });
  if (error) throw error;
  meta = { empreintes: {} }; ecrireMeta();
  await demarrer();
}

/** Joint un foyer existant : les données du foyer remplacent celles de ce téléphone. */
export async function joindreFoyer(code, prenom) {
  const { error } = await sb.rpc('joindre_foyer', { p_code: code, p_nom_affiche: prenom });
  if (error) throw error;
  S.maj((e) => { for (const c of Object.values(COLLECTIONS)) e[c] = []; });
  meta = { empreintes: {} }; ecrireMeta();
  await demarrer();
}

// ---------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------
/** Tout l'état partageable, en lignes { type, id, data }. Donne un id à ce qui n'en a pas. */
function objetsLocaux() {
  const e = S.get();
  const out = [];
  for (const [type, coll] of Object.entries(COLLECTIONS)) {
    for (const o of e[coll] || []) {
      if (type !== 'cp' && !o.id) o.id = S.uid(type.slice(0, 2));
      out.push({ type, id: String(cleDe(type, o)), data: o });
    }
  }
  out.push({ type: 'reglages', id: 'foyer', data: Object.fromEntries(REGLAGES.map((k) => [k, e[k] ?? null])) });
  return out;
}

function planifierEnvoi() {
  if (!estPret()) return;
  clearTimeout(minuterie);
  minuterie = setTimeout(() => pousser().catch(() => {}), 900);
}

/** Envoie ce qui a changé sur ce téléphone depuis le dernier envoi. */
export async function pousser() {
  if (!estPret() || !navigator.onLine || enEnvoi) return;
  enEnvoi = true;
  try {
    const locaux = objetsLocaux();
    const vus = new Set();
    const lignes = [];
    for (const o of locaux) {
      const k = `${o.type}:${o.id}`; vus.add(k);
      const json = JSON.stringify(o.data);
      if (meta.empreintes[k] !== json) lignes.push({ foyer_id: foyer.id, type: o.type, id: o.id, data: o.data, supprime: false, _k: k, _json: json });
    }
    // Éléments supprimés sur ce téléphone → suppression douce (sauf l'historique des prix)
    for (const k of Object.keys(meta.empreintes)) {
      if (vus.has(k)) continue;
      const [type, ...r] = k.split(':'); const id = r.join(':');
      if (type === 'prix') { delete meta.empreintes[k]; continue; }
      lignes.push({ foyer_id: foyer.id, type, id, data: JSON.parse(meta.empreintes[k]), supprime: true, _k: k, _json: null });
    }
    // Un élément refusé par la base ne doit JAMAIS bloquer les autres (incident du 2026-11-16 :
    // un seul prix refusé faisait échouer tout le paquet de 200, plus rien ne passait).
    const envoyer = async (lot) => {
      const { error } = await sb.from('objets').upsert(lot.map(({ _k, _json, ...l }) => l), { onConflict: 'foyer_id,type,id' });
      if (!error) { lot.forEach((l) => { if (l._json == null) delete meta.empreintes[l._k]; else meta.empreintes[l._k] = l._json; }); ecrireMeta(); }
      return error;
    };
    const refuses = await envoyerParPaquets(lignes, envoyer, new Set((meta.refuses || []).map((r) => r.k)));
    if (refuses.length) console.warn('Synchronisation : élément(s) refusé(s) par la base', refuses);
    // Prix modifié sur ce téléphone alors que la base les garde en ajout seulement (incident du 2026-11-19 :
    // 102 prix dont la variante avait été réécrite) → on reprend la version de la base, rien n'est perdu.
    const aRetablir = refuses.filter((r) => r.k.startsWith('prix:') && /ajout seulement/i.test(r.erreur) && meta.empreintes[r.k]);
    if (aRetablir.length) {
      S.maj((e) => {
        for (const r of aRetablir) {
          const id = r.k.slice(5);
          const i = (e.prix || []).findIndex((p) => String(cleDe('prix', p)) === id);
          if (i >= 0) e.prix[i] = JSON.parse(meta.empreintes[r.k]);
        }
      });
    }
    meta.refuses = refuses.filter((r) => !aRetablir.includes(r));
    await envoyerPhotos();
    meta.erreurEnvoi = null;
    meta.dernier = new Date().toISOString(); ecrireMeta(); signaler();
  } catch (err) {
    console.warn('Synchronisation : envoi reporté', err);
    meta.erreurEnvoi = err?.message || String(err); ecrireMeta(); signaler();
  } finally { enEnvoi = false; }
}

/** Récupère ce que l'autre téléphone a changé. */
export async function tirer() {
  if (!estPret() || !navigator.onLine) return;
  let q = sb.from('objets').select('type,id,data,supprime,maj').eq('foyer_id', foyer.id).order('maj', { ascending: true }).limit(5000);
  if (meta.dernierTire) q = q.gt('maj', meta.dernierTire);
  const { data, error } = await q;
  if (error) { console.warn(error); return; }
  if (data.length) {
    appliquer(data);
    meta.dernierTire = data[data.length - 1].maj; ecrireMeta();
  }
}

function appliquer(lignes) {
  S.maj((e) => {
    for (const l of lignes) {
      const k = `${l.type}:${l.id}`;
      if (l.type === 'reglages') { for (const c of REGLAGES) if (l.data[c] != null) e[c] = l.data[c]; meta.empreintes[k] = JSON.stringify(l.data); continue; }
      const coll = COLLECTIONS[l.type];
      if (!coll) continue;
      e[coll] ||= [];
      const i = e[coll].findIndex((o) => String(cleDe(l.type, o)) === l.id);
      if (l.supprime) { if (i >= 0) e[coll].splice(i, 1); delete meta.empreintes[k]; continue; }
      if (i >= 0) e[coll][i] = l.data; else e[coll].push(l.data);
      meta.empreintes[k] = JSON.stringify(l.data);
    }
  });
  ecrireMeta();
}

function ecouterTempsReel() {
  canal = sb.channel(`foyer-${foyer.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'objets', filter: `foyer_id=eq.${foyer.id}` }, (p) => {
      if (!p.new?.type) return;
      appliquer([p.new]);
      if (p.new.maj > (meta.dernierTire || '')) { meta.dernierTire = p.new.maj; ecrireMeta(); }
    })
    .subscribe();
}

// ---------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------
const cheminPhoto = (id) => `${foyer.id}/${id}.jpg`;

async function envoyerPhotos() {
  const aEnvoyer = (S.get().photos || []).filter((p) => !p.enLigne);
  for (const p of aEnvoyer) {
    const blob = await S.lirePhoto(p.id);
    if (!blob) continue;
    const { error } = await sb.storage.from('photos').upload(cheminPhoto(p.id), blob, { contentType: 'image/jpeg', upsert: true });
    if (error) { console.warn('Photo non envoyée', error); continue; }
    S.maj((e) => { const x = e.photos.find((y) => y.id === p.id); if (x) x.enLigne = true; });
  }
}

async function telechargerPhoto(id) {
  if (!estPret() || !navigator.onLine) return null;
  const { data, error } = await sb.storage.from('photos').download(cheminPhoto(id));
  return error ? null : data;
}

/** Retire du téléphone les photos déjà sauvegardées en ligne. Retourne le nombre retiré. */
export async function libererEspacePhotos() {
  let n = 0;
  for (const p of (S.get().photos || []).filter((x) => x.enLigne)) {
    if (await S.photoLocaleExiste(p.id)) { await S.supprimerPhotoLocale(p.id); n++; }
  }
  return n;
}

// ---------------------------------------------------------------------
// IA : lecture d'une photo par Claude (fonction « lire-photo »)
// ---------------------------------------------------------------------
const enBase64 = (blob) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => ko(r.error);
  r.readAsDataURL(blob);
});

/** Retourne les données lues, ou null (pas connecté, hors ligne, fonction absente, erreur). */
export async function lireAvecIA(type, blobs, extra = {}) {
  if (!sb || !session || !navigator.onLine) return null;
  try {
    const images = await Promise.all(blobs.map(async (b) => ({ data: await enBase64(b), media_type: 'image/jpeg' })));
    const { data, error } = await sb.functions.invoke('lire-photo', { body: { type, images, ...extra } });
    if (error || !data?.ok) { console.warn('IA indisponible', error || data?.erreur); return null; }
    return data.data;
  } catch (err) {
    console.warn('IA indisponible', err);
    return null;
  }
}

/** Codes-barres possibles d'un produit par marque + nom (Open Food Facts, via la fonction). [] si rien / indisponible. */
export async function chercherCodesEnLigne(q, marque) {
  if (!sb || !session || !navigator.onLine) return null;
  try {
    const { data, error } = await sb.functions.invoke('lire-photo', { body: { type: 'chercher_code', q, marque } });
    return error || !data?.ok ? null : data.data;
  } catch { return null; }
}

/** Nom, marque et photos d'un code-barres (base UPCitemdb, via la fonction). null si indisponible. */
export async function chercherCode(code) {
  if (!sb || !session || !navigator.onLine) return null;
  try {
    const { data, error } = await sb.functions.invoke('lire-photo', { body: { type: 'code', code } });
    return error || !data?.ok ? null : data.data;
  } catch { return null; }
}

/**
 * Preuve d'un rabais de circulaire : lien (valide 1 h) vers l'image de la page où il a été lu.
 * { idOffre: url } pour celles dont la page est encore gardée (absente = page effacée) ; null hors ligne ou en erreur.
 */
export async function pagesDesOffres(idsOffres) {
  const ids = [...new Set(idsOffres)].filter(Boolean);
  if (!ids.length || !estPret() || !navigator.onLine) return null;
  try {
    const { data: offres } = await sb.from('offres_circulaires').select('id, page_id').in('id', ids);
    const parPage = new Map((offres || []).filter((o) => o.page_id).map((o) => [o.id, o.page_id]));
    if (!parPage.size) return {};
    const { data: pages } = await sb.from('pages_circulaires').select('id, chemin').in('id', [...new Set(parPage.values())]);
    const chemins = new Map((pages || []).filter((p) => p.chemin).map((p) => [p.id, p.chemin]));
    if (!chemins.size) return {};
    const { data: urls } = await sb.storage.from('circulaires').createSignedUrls([...new Set(chemins.values())], 3600);
    const parChemin = new Map((urls || []).filter((u) => u.signedUrl).map((u) => [u.path, u.signedUrl]));
    const res = {};
    for (const [offre, page] of parPage) { const u = parChemin.get(chemins.get(page)); if (u) res[offre] = u; }
    return res;
  } catch (err) { console.warn('Pages de circulaire indisponibles', err); return null; }
}

export function synchroniserMaintenant() { return tirer().then(pousser); }
