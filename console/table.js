// =====================================================================
// Console — table virtualisée (seules les lignes visibles existent dans la page).
// Colonnes redimensionnables, tri par en-tête, lignes de groupe, focus clavier.
// Aucune dépendance.
// =====================================================================

export class TableVirtuelle {
  /**
   * @param {HTMLElement} hote
   * @param {{ colonnes, cle, surClic?, surDouble?, surTri?, surLargeur?, classes?, rendreGroupe?, vide? }} o
   *   colonnes : [{ cle, titre, largeur (px), souple?, tri?, rendu(item) → html, aligne? }]
   */
  constructor(hote, o) {
    this.o = o;
    this.items = [];
    this.focusI = -1;
    this.tri = null;
    hote.innerHTML = '<div class="table"><div class="corps" tabindex="-1"><div class="interieur"><div class="tete" role="row"></div><div class="espaceur"></div></div></div></div>';
    this.racine = hote.firstElementChild;
    this.corps = this.racine.querySelector('.corps');
    this.interieur = this.racine.querySelector('.interieur');
    this.tete = this.racine.querySelector('.tete');
    this.espaceur = this.racine.querySelector('.espaceur');
    this.corps.addEventListener('scroll', () => this.planifier(), { passive: true });
    new ResizeObserver(() => this.planifier()).observe(this.corps);
    // Double-clic détecté ici (même ligne, même colonne, < 450 ms) : le premier clic redessine la ligne
    // (ouverture de la fiche), et le navigateur ne reconnaît alors plus le « dblclick » natif.
    this.espaceur.addEventListener('click', (ev) => {
      const l = ev.target.closest('.ligne');
      const cle = l ? `${l.dataset.id}|${ev.target.closest('[data-col]')?.dataset.col}` : null;
      const maintenant = Date.now();
      const surCase = ev.target.matches('[data-sel], [data-act], [data-edit], button, input, select');
      if (!surCase && cle && this.dernierClic && this.dernierClic.cle === cle && maintenant - this.dernierClic.t < 450) {
        clearTimeout(this.clicDiffere);
        this.dernierClic = null;
        this.evenement(ev, this.o.surDouble);
        return;
      }
      this.dernierClic = { cle, t: maintenant };
      // Colonne modifiable : on attend un instant avant le clic simple (ouvrir la fiche rétrécit le tableau
      // et déplacerait la colonne sous la souris → le 2e clic tomberait ailleurs).
      const col = ev.target.closest('[data-col]')?.dataset.col;
      if (!surCase && this.o.colonnes.find((c) => c.cle === col)?.edit) {
        const cible = ev.target;
        clearTimeout(this.clicDiffere);
        this.clicDiffere = setTimeout(() => { if (this.dernierClic?.cle === cle) this.evenement({ target: cible }, this.o.surClic); }, 260);
        return;
      }
      this.evenement(ev, this.o.surClic);
    });
    this.construireTete();
  }

  evenement(ev, f) {
    const l = ev.target.closest('.ligne');
    if (!l || !f) return;
    const i = +l.dataset.i;
    f(this.items[i], i, ev);
  }

  hauteur() { return parseFloat(getComputedStyle(this.racine).getPropertyValue('--ligne')) || 32; }

  majColonnes() {
    const cols = this.o.colonnes.filter((c) => !c.cache);
    const gabarit = cols.map((c) => (c.souple ? `minmax(${c.largeur}px, 1fr)` : `${c.largeur}px`)).join(' ');
    this.racine.style.setProperty('--colonnes', gabarit);
    this.interieur.style.minWidth = cols.reduce((s, c) => s + c.largeur, 0) + 'px';
  }

  construireTete() {
    this.majColonnes();
    const cols = this.o.colonnes.filter((c) => !c.cache);
    this.tete.innerHTML = cols.map((c) => {
      const fl = this.tri?.cle === c.cle ? (this.tri.sens > 0 ? ' ↑' : ' ↓') : '';
      return `<div ${c.tri ? `data-tri="${c.cle}"` : ''} title="${c.aide || ''}" style="${c.aligne ? `justify-content:${c.aligne}` : ''}">${c.titre}${fl}<span class="poignee" data-col="${c.cle}"></span></div>`;
    }).join('');
    this.tete.onclick = (ev) => {
      if (ev.target.classList.contains('poignee')) return;
      const k = ev.target.closest('[data-tri]')?.dataset.tri;
      if (!k) return;
      this.tri = { cle: k, sens: this.tri?.cle === k ? -this.tri.sens : 1 };
      this.o.surTri?.(this.tri);
      this.construireTete();
    };
    this.tete.onmousedown = (ev) => {
      const p = ev.target.closest('.poignee');
      if (!p) return;
      ev.preventDefault();
      const col = this.o.colonnes.find((c) => c.cle === p.dataset.col);
      const x0 = ev.clientX, l0 = col.largeur;
      const bouger = (e) => { col.largeur = Math.max(40, l0 + e.clientX - x0); this.majColonnes(); };
      const fin = () => { removeEventListener('mousemove', bouger); removeEventListener('mouseup', fin); this.o.surLargeur?.(col); };
      addEventListener('mousemove', bouger); addEventListener('mouseup', fin);
    };
  }

  donnees(items, { garderDefilement = true } = {}) {
    this.items = items;
    if (!garderDefilement) this.corps.scrollTop = 0;
    if (this.focusI >= items.length) this.focusI = items.length - 1;
    this.espaceur.style.height = items.length * this.hauteur() + 'px';
    this.rendre(true);
  }

  planifier() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = null; this.rendre(); });
  }

  rafraichir() { this.rendre(true); }

  rendre(force = false) {
    const h = this.hauteur();
    this.espaceur.style.height = this.items.length * h + 'px';
    if (!this.items.length) { this.espaceur.innerHTML = `<div class="vide">${this.o.vide || 'Aucune ligne.'}</div>`; this.dernier = null; return; }
    const tete = this.tete.offsetHeight;
    const haut = Math.max(0, this.corps.scrollTop - tete);
    const debut = Math.max(0, Math.floor(haut / h) - 8);
    const fin = Math.min(this.items.length, Math.ceil((haut + this.corps.clientHeight) / h) + 8);
    const sig = `${debut}:${fin}`;
    if (!force && sig === this.dernier) return;
    this.dernier = sig;
    const cols = this.o.colonnes.filter((c) => !c.cache);
    let html = '';
    for (let i = debut; i < fin; i++) {
      const it = this.items[i];
      const top = i * h;
      if (it.groupe) { html += `<div class="ligne groupe" data-i="${i}" style="top:${top}px"><div>${this.o.rendreGroupe ? this.o.rendreGroupe(it) : it.groupe}</div></div>`; continue; }
      const cl = (this.o.classes?.(it) || '') + (i === this.focusI ? ' focus' : '');
      html += `<div class="ligne ${cl}" role="row" data-i="${i}" data-id="${this.o.cle(it)}" style="top:${top}px">`;
      for (const c of cols) html += `<div data-col="${c.cle}" style="${c.aligne ? `text-align:${c.aligne}` : ''}">${c.rendu(it)}</div>`;
      html += '</div>';
    }
    this.espaceur.innerHTML = html;
  }

  /** Met le focus clavier sur la ligne i et la fait défiler à l'écran. */
  focus(i) {
    if (!this.items.length) return;
    i = Math.max(0, Math.min(this.items.length - 1, i));
    if (this.items[i]?.groupe) i = Math.min(this.items.length - 1, i + (i >= this.focusI ? 1 : -1));
    this.focusI = i;
    const h = this.hauteur(), tete = this.tete.offsetHeight;
    const y = i * h + tete;
    if (y - tete < this.corps.scrollTop) this.corps.scrollTop = y - tete;
    else if (y + h > this.corps.scrollTop + this.corps.clientHeight) this.corps.scrollTop = y + h - this.corps.clientHeight;
    this.rendre(true);
  }

  focusParId(id) {
    const i = this.items.findIndex((it) => !it.groupe && this.o.cle(it) === id);
    if (i >= 0) this.focus(i);
    return i;
  }

  ligneDom(id) { return this.espaceur.querySelector(`.ligne[data-id="${CSS.escape(id)}"]`); }
}
