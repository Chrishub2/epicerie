// =====================================================================
// Console — source des VRAIES données (Supabase), en LECTURE SEULE (étape C3).
// - Même projet, même connexion que l'app téléphone (même site : la session est partagée).
// - Lit la table `objets` du foyer, page par page, et l'historique (`objets_historique`, étape C2).
// - Écoute le temps réel : un changement fait au téléphone apparaît dans la console.
// - N'écrit RIEN : aucune fonction d'écriture ici (l'écriture arrive à l'étape C4, via ecrire_objet).
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
    Object.defineProperty(o, '_version', { value: l.version ?? null, enumerable: false, writable: true });
    if (l.type === 'article') { o.maj = l.maj; o.majPar = noms.get(l.maj_par) || (l.maj_par ? 'membre' : '—'); }
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
      .select('hid, type, id, version, operation, data_avant, data, par, source, quand')
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

  nomMembre(uid) { return this.membres.find((m) => m.user_id === uid)?.nom_affiche || (uid ? 'membre' : 'serveur'); }
}
