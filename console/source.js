// =====================================================================
// Console — source des VRAIES données (Supabase) : lecture (C3) et écriture contrôlée (C4).
// - Même projet, même connexion que l'app téléphone (même site : la session est partagée).
// - Lit la table `objets` du foyer, page par page, et l'historique (`objets_historique`, étape C2).
// - Écoute le temps réel : un changement fait au téléphone apparaît dans la console.
// - Écrit (étape C4) seulement via ecrire_objet : contrôle de version, historique, source « console ».
// =====================================================================
import { SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, SUPABASE_JS } from '../config.js';

/** type en base → collection de l'état (même correspondance que app/sync.js). */
export const COLLECTIONS = {
  article: 'articles', liste: 'liste', prix: 'prix', magasin: 'magasins', rayon: 'rayons',
  recette: 'recettes', livre: 'livres', carte: 'cartes', point: 'points', rabais: 'rabaisPerso',
  photo: 'photos', recu: 'recus', releve: 'releves', cp: 'codesPostaux',
};
// Cartes fidélité et points : jamais chargés dans la console (inutiles ici, et données sensibles).
const TYPES_LUS = ['article', 'rayon', 'prix', 'photo', 'recu', 'magasin', 'liste', 'recette', 'cp', 'rabais', 'livre', 'releve'];

/**
 * Construit l'état (même structure que l'app) à partir des lignes de `objets`.
 * Pure : testable sans réseau. Ajoute à chaque objet, en mémoire seulement, `_version`, `maj` et `majPar`.
 */
export function construireEtat(lignes, membres = []) {
  const noms = new Map(membres.map((m) => [m.user_id, m.nom_affiche]));
  const e = { reel: true, version: 4, rayons: [], articles: [], prix: [], photos: [], recus: [], liste: [], magasins: [], codesPostaux: [], recettes: [], livres: [], rabaisPerso: [], releves: [] };
  for (const l of lignes) {
    const coll = COLLECTIONS[l.type];
    if (!coll || !TYPES_LUS.includes(l.type) || l.supprime || !l.data || typeof l.data !== 'object') continue; // jamais de cartes ni de points
    const o = l.data;
    // Propriétés de la console seulement : non énumérables, donc JAMAIS renvoyées dans la base (JSON.stringify les ignore).
    const cache = (k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, writable: true, configurable: true });
    cache('_version', l.version ?? null);
    cache('_base', JSON.parse(JSON.stringify(o))); // valeur connue de la base : sert à repérer MES changements en cas de conflit
    if (l.type === 'article') { cache('maj', l.maj); cache('majPar', noms.get(l.maj_par) || (l.maj_par ? 'membre' : '—')); }
    (e[coll] ||= []).push(o);
  }
  return e;
}

/** Résume les champs changés entre deux versions JSON (premier niveau). */
export function differences(avant, apres, max = 4) {
  if (!avant || !apres) return [];
  const cles = [...new Set([...Object.keys(avant), ...Object.keys(apres)])].filter((k) => !['maj', 'majPar'].includes(k));
  const court = (v) => { if (v == null || v === '') return '(vide)'; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; };
  return cles.filter((k) => JSON.stringify(avant[k]) !== JSON.stringify(apres[k])).slice(0, max)
    .map((k) => ({ champ: k, avant: court(avant[k]), apres: court(apres[k]) }));
}

export class SourceSupabase {
  constructor() { this.sb = null; this.foyer = null; this.membres = []; this.canal = null; }

  async connecter() {
    const { createClient } = await import(SUPABASE_JS);
    // Mêmes options que l'app : la session enregistrée par l'app sur ce navigateur est réutilisée.
    this.sb = createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    const { data } = await this.sb.auth.getSession();
    return data.session;
  }

  /** Connexion par courriel + mot de passe (saisis par Chris ; rien n'est enregistré par la console). */
  async seConnecter(courriel, motDePasse) {
    const { error } = await this.sb.auth.signInWithPassword({ email: courriel, password: motDePasse });
    if (error) throw error;
  }

  async deconnecter() { await this.sb.auth.signOut(); }

  /** Foyer du membre connecté + liste des membres. null si le compte n'a pas de foyer. */
  async chargerFoyer() {
    const { data: s } = await this.sb.auth.getSession();
    const uid = s.session?.user?.id;
    const { data, error } = await this.sb.from('membres').select('foyer_id, nom_affiche, foyers(id, nom)').eq('user_id', uid).limit(1);
    if (error) throw error;
    if (!data?.length) return null;
    this.foyer = data[0].foyers;
    const { data: m } = await this.sb.from('membres').select('user_id, nom_affiche').eq('foyer_id', this.foyer.id);
    this.membres = m || [];
    return this.foyer;
  }

  /** Tous les objets utiles du foyer, par pages de 1 000 (RLS : seulement ce foyer). */
  async chargerObjets(surProgres = () => {}) {
    const lignes = [];
    for (let debut = 0; ; debut += 1000) {
      const { data, error } = await this.sb.from('objets').select('type, id, data, supprime, version, maj, maj_par')
        .eq('foyer_id', this.foyer.id).eq('supprime', false).in('type', TYPES_LUS)
        .order('type').order('id').range(debut, debut + 999);
      if (error) throw error;
      lignes.push(...data);
      surProgres(lignes.length);
      if (data.length < 1000) break;
    }
    return lignes;
  }

  /** Dernières modifications enregistrées par la base (étape C2). */
  async chargerHistorique(limite = 300) {
    const { data, error } = await this.sb.from('objets_historique')
      .select('hid, type, id, version, operation, data_avant, data, supprime, par, source, quand')
      .eq('foyer_id', this.foyer.id).neq('type', 'carte').neq('type', 'point')
      .order('hid', { ascending: false }).limit(limite);
    if (error) throw error;
    return data;
  }

  /** Temps réel : appelle fn(ligne) à chaque changement d'un objet du foyer. */
  ecouter(fn, surEtat = () => {}) {
    this.canal = this.sb.channel(`console-${this.foyer.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'objets', filter: `foyer_id=eq.${this.foyer.id}` }, (p) => { if (p.new?.type) fn(p.new); })
      .subscribe((statut) => surEtat(statut));
  }

  /**
   * Écrit un objet avec contrôle de version (fonction ecrire_objet, étape C2).
   * Retourne la nouvelle version. Erreur `conflit` (code 40001) si l'objet a changé ailleurs depuis `version`.
   * Les champs propres à la console (non énumérables) ne sont jamais envoyés.
   */
  async ecrire(type, id, data, version, source = 'console', supprime = false) {
    const propre = JSON.parse(JSON.stringify(data));
    const { data: v, error } = await this.sb.rpc('ecrire_objet', {
      p_foyer: this.foyer.id, p_type: type, p_id: id, p_data: propre, p_version: version, p_supprime: supprime, p_source: source,
    });
    if (error) { const e = new Error(error.message); e.code = error.code; e.conflit = error.code === '40001' || /conflit/.test(error.message); throw e; }
    return v;
  }

  /** Problèmes que Chris a écartés (« pas un problème ») : leurs clés, pour ne plus les afficher. */
  async chargerDecisions() {
    const { data, error } = await this.sb.from('propositions').select('correction')
      .eq('foyer_id', this.foyer.id).in('statut', ['pas_un_probleme', 'rejetee']).limit(5000);
    if (error) throw error;
    return (data || []).map((d) => d.correction?.cle).filter(Boolean);
  }

  /** Enregistre « pas un problème » pour ce problème (table propositions, étape C2). Rien d'autre n'est modifié. */
  async ecarter(p) {
    const { data: s } = await this.sb.auth.getSession();
    const { error } = await this.sb.from('propositions').insert({
      foyer_id: this.foyer.id, origine: 'regle', priorite: p.priorite, code: p.code,
      cibles: p.cibles.map((id) => ({ type: 'article', id })), probleme: String(p.probleme || p.titre).slice(0, 500),
      raison: p.raison || null, confiance: p.confiance ?? null, correction: { cle: p.cle, prixId: p.prixId || null },
      statut: 'pas_un_probleme', decide_par: s.session?.user?.id || null, decide_le: new Date().toISOString(),
    });
    if (error) throw error;
  }

  /** Relit un objet tel qu'il est dans la base (après un conflit). */
  async relire(type, id) {
    const { data, error } = await this.sb.from('objets').select('type, id, data, supprime, version, maj, maj_par')
      .eq('foyer_id', this.foyer.id).eq('type', type).eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  nomMembre(uid) { return this.membres.find((m) => m.user_id === uid)?.nom_affiche || (uid ? 'membre' : 'serveur'); }
}
