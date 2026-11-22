/* PDF del canzoniere (tutti i canti, quelli dell'elenco o una scaletta), come quello originale:
   copertina, «Vieni o Spirito Creatore», indice cliccabile, canti, «Vieni Santo Spirito».
   In fondo a ogni pagina "indice" riporta all'indice; ogni voce dell'indice porta al suo canto. */

const PDF = {
  L: 419.53, H: 595.28,          // A5 in punti, come il PDF originale
  sx: 34, dx: 34, su: 34, giu: 44,  // margini
  rosso: [168, 38, 28], grigio: [110, 104, 96],
  rigaAccordi: 9.5, rigaTesto: 13, spazioBlocco: 6, spazioCanti: 18,
};
PDF.larghezza = PDF.L - PDF.sx - PDF.dx;

/** jsPDF si scarica solo quando serve (poi resta nella copia dell'app, anche senza rete). */
function caricaJsPDF() {
  if (window.jspdf) return Promise.resolve();
  return new Promise((ok, errore) => {
    const s = document.createElement("script");
    s.src = "jspdf.umd.min.js";
    s.onload = ok;
    s.onerror = () => errore(new Error("libreria PDF non disponibile"));
    document.head.append(s);
  });
}

// i caratteri dei font standard del PDF: si tolgono quelli che non saprebbe scrivere
const EXTRA_WINANSI = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const pulisci = s => [...(s || "").replace(/♩/g, "").replace(/\s+$/, "")]
  .map(c => c.charCodeAt(0) <= 255 || EXTRA_WINANSI.includes(c) ? c : "").join("");

/** Una riga ChordPro senza accordi. Il "-" fra due accordi ("gno[La7]-[Re]re") serviva solo a far posto
    all'accordo e se ne va; i trattini scritti nel testo ("A - Alle-lu-u-ia") restano. */
const senzaAccordi = riga => riga.replace(/\[[^\]]*\]\s*-\s*(?=\[)/g, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
/** Nel PDF solo testo le note "DA CONTROLLARE" (promemoria, quasi sempre sugli accordi) non servono a chi canta. */
const notaInterna = testo => /^\s*da controllare/i.test(testo || "");

/** Prepara le righe di un canto (misurate ma non ancora disegnate): ciascuna { h, disegna(doc, y), unita }.
    k rimpicciolisce tutto (caratteri, righe, spazi): serve perché un canto lungo stia in una pagina.
    soloTesto: senza accordi, melodia, sequenze di accordi e tonalità (meno pagine da stampare). */
function righeCanto(doc, canto, k = 1, soloTesto = false) {
  const n = trasposizioneDi(canto);
  const bemolli = usaBemolli(leggiTonalita(canto.meta.key), n);
  const acc = a => pulisci(trasponiAccordo(a, n, bemolli, stato.int));
  const righe = [];
  const metti = (h, disegna, unita = false) => righe.push({ h, disegna, unita });
  const font = (stile, dim, colore = [0, 0, 0], famiglia = "times") => {
    doc.setFont(famiglia, stile); doc.setFontSize(dim); doc.setTextColor(...colore);
  };

  // intestazione: titolo, autore, tonalità e tempo, melodia
  const m = canto.meta;
  font("bold", 14 * k);
  for (const r of doc.splitTextToSize(pulisci(m.title), PDF.larghezza)) metti(17 * k, (d, y) => { font("bold", 14 * k); d.text(r, PDF.sx, y + 13 * k); }, true);
  const dettagli = [m.subtitle, m.artist].filter(Boolean).join(" · ");
  if (dettagli) metti(11 * k, (d, y) => { font("italic", 8.5 * k, PDF.grigio); d.text(pulisci(dettagli), PDF.sx, y + 8.5 * k); }, true);
  const { bpm, metro } = tempoMetronomo(canto);
  const info = [m.key && "Tonalità " + nomeTonalita(canto, n), metro, bpm && "ritmo " + bpm].filter(Boolean).join(" · ");
  if (info && !soloTesto) metti(11 * k, (d, y) => { font("normal", 7.5 * k, PDF.grigio, "helvetica"); d.text(pulisci(info), PDF.sx, y + 8 * k); }, true);
  for (const b of canto.blocchi) {
    if (soloTesto || b.tipo !== "melodia" || /start_of_abc/i.test(b.sorgente)) continue;
    const note = [...b.sorgente.matchAll(/^\s*note\s*:(.*)$/gim)].map(x => x[1].replace(/\[[^\]]*\]/g, "").trim()).filter(Boolean).join("  ");  // senza gli accordi sopra il rigo
    if (note) {
      font("italic", 8 * k);
      for (const r of doc.splitTextToSize(pulisci("Melodia: " + note), PDF.larghezza))
        metti(10 * k, (d, y) => { font("italic", 8 * k, PDF.grigio); d.text(r, PDF.sx, y + 8 * k); }, true);
    }
  }
  metti(4 * k, () => {}, true);

  // una riga ChordPro -> righe visive con gli accordi sopra le sillabe (si va a capo se non ci sta)
  const rigaConAccordi = (riga, rientro, stile) => {
    const coppie = [];
    const re = /\[([^\]]*)\]/g;
    let ultimo = 0, accordo = null, x;
    while ((x = re.exec(riga))) { coppie.push([accordo, riga.slice(ultimo, x.index)]); accordo = x[1]; ultimo = re.lastIndex; }
    coppie.push([accordo, riga.slice(ultimo)]);
    // parole: pezzi [accordo, sillaba] senza spazi in mezzo
    const parole = [];
    let corrente = [];
    for (const [a, testo] of coppie) {
      let primo = true;
      for (const parte of testo.split(/(\s+)/)) {
        if (/^\s+$/.test(parte)) {
          if (primo && a) { corrente.push([a, ""]); primo = false; }
          if (corrente.length) parole.push(corrente);
          corrente = [];
          continue;
        }
        if (!parte && !(primo && a)) continue;
        corrente.push([primo ? a : null, parte]);
        primo = false;
      }
      if (primo && a) corrente.push([a, ""]);
    }
    if (corrente.length) parole.push(corrente);
    // misure
    const misura = (testo, accordo) => {
      doc.setFont("times", stile); doc.setFontSize(11 * k);
      const tw = doc.getTextWidth(pulisci(testo));
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5 * k);
      const cw = accordo ? doc.getTextWidth(acc(accordo)) + 3 * k : 0;
      return { tw, cw, w: Math.max(tw, cw) };
    };
    doc.setFont("times", stile); doc.setFontSize(11 * k);
    const spazio = doc.getTextWidth(" ");
    const visive = [[]];
    let xCur = 0;
    const max = PDF.larghezza - rientro;
    for (const parola of parole) {
      const pezzi = parola.map(([a, t]) => ({ a, t, ...misura(t, a) }));
      const w = pezzi.reduce((s, p) => s + p.w, 0);
      if (xCur > 0 && xCur + w > max) { visive.push([]); xCur = 12 * k; }  // a capo, un po' rientrato
      let xp = xCur;
      for (const [i, p] of pezzi.entries()) {
        visive[visive.length - 1].push({ ...p, x: xp, trattino: i < pezzi.length - 1 && p.cw > p.tw && p.t.trim() });
        xp += p.w;
      }
      xCur = xp + spazio;
    }
    for (const pezzi of visive) {
      const conAccordi = pezzi.some(p => p.a);
      const conTesto = pezzi.some(p => p.t.trim());
      const h = (conAccordi ? PDF.rigaAccordi * k : 0) + (conTesto ? PDF.rigaTesto * k : 3 * k);
      metti(h, (d, y) => {
        const yAcc = y + 8 * k, yTesto = y + (conAccordi ? PDF.rigaAccordi * k : 0) + 10 * k;
        for (const p of pezzi) {
          const x0 = PDF.sx + rientro + p.x;
          if (p.a) { d.setFont("helvetica", "bold"); d.setFontSize(8.5 * k); d.setTextColor(...PDF.rosso); d.text(acc(p.a), x0, yAcc); }
          if (p.t) { d.setFont("times", stile); d.setFontSize(11 * k); d.setTextColor(0, 0, 0); d.text(pulisci(p.t), x0, yTesto); }
          if (p.trattino) {  // l'accordo allarga la parola: un trattino ricuce le sillabe
            d.setTextColor(...PDF.grigio); d.text("-", x0 + p.tw + (p.w - p.tw) / 2 - 1.5 * k, yTesto);
          }
        }
      });
    }
  };

  for (const b of canto.blocchi) {
    if (["verso", "libero", "ritornello", "ponte"].includes(b.tipo)) {
      const rit = b.tipo === "ritornello";
      const rientro = rit ? 20 * k : 0;
      const inizio = righe.length;
      for (const r of b.righe) {
        if (r.commento && soloTesto && notaInterna(r.commento)) continue;
        if (r.commento) metti(11 * k, (d, y) => { font("italic", 8.5 * k, PDF.grigio); d.text(pulisci(r.commento), PDF.sx + rientro, y + 8.5 * k); });
        else if (!soloTesto) rigaConAccordi(r, rientro, rit ? "italic" : "normal");
        else if (senzaAccordi(r)) rigaConAccordi(senzaAccordi(r), rientro, rit ? "italic" : "normal");  // le righe di soli accordi spariscono
      }
      if (rit && righe[inizio]) {  // "Rit." accanto alla prima riga del ritornello
        const prima = righe[inizio].disegna;
        righe[inizio].disegna = (d, y) => {
          prima(d, y);
          font("bold", 7 * k, PDF.rosso, "helvetica");
          d.text("Rit.", PDF.sx, y + righe[inizio].h - 3 * k);
        };
      }
      metti(PDF.spazioBlocco * k, () => {});
    } else if (b.tipo === "rif-ritornello") {
      metti(14 * k, (d, y) => { font("bold", 8 * k, PDF.rosso, "helvetica"); d.text("Rit.", PDF.sx, y + 9 * k); });
    } else if (b.tipo === "sequenza" && !soloTesto) {
      const testo = (b.etichetta ? b.etichetta + ":  " : "") + b.accordi.map(acc).join("   ");
      font("bold", 8.5 * k, PDF.rosso, "helvetica");
      for (const r of doc.splitTextToSize(pulisci(testo), PDF.larghezza))
        metti(12 * k, (d, y) => { font("bold", 8.5 * k, PDF.rosso, "helvetica"); d.text(r, PDF.sx, y + 9 * k); });
      metti(PDF.spazioBlocco / 2 * k, () => {});
    } else if (b.tipo === "commento" && !(soloTesto && notaInterna(b.testo))) {
      metti(12 * k, (d, y) => { font("italic", 9 * k, PDF.grigio); d.text(pulisci(b.testo), PDF.sx, y + 9 * k); });
    }
  }
  return righe;
}

/** Distribuisce i canti nelle pagine. Un canto non si divide mai tra due pagine: se non ci sta
    nello spazio rimasto va alla pagina dopo; se è più lungo di una pagina intera si rimpicciolisce. */
function impagina(doc, canti, soloTesto = false) {
  const alto = PDF.H - PDF.su - PDF.giu;
  const pagine = [[]];
  let y = 0;
  const posizioni = new Map();
  const misura = (canto, k) => {
    const righe = righeCanto(doc, canto, k, soloTesto);
    while (righe.length && righe[righe.length - 1].h <= PDF.spazioBlocco * k && !righe[righe.length - 1].unita) righe.pop();
    return { righe, totale: righe.reduce((s, r) => s + r.h, 0) };
  };
  for (const canto of canti) {
    let k = 1, { righe, totale } = misura(canto, k);
    while (totale > alto && k > .5) ({ righe, totale } = misura(canto, k = Math.round((k - .04) * 100) / 100));
    const prima = y > 0 ? PDF.spazioCanti : 0;
    if (y > 0 && y + prima + totale > alto) {
      pagine.push([]); y = 0;
    } else if (y > 0) {
      const ySep = y + prima / 2;
      pagine[pagine.length - 1].push(d => { d.setDrawColor(210, 200, 190); d.setLineWidth(.5); d.line(PDF.sx + 60, PDF.su + ySep, PDF.L - PDF.dx - 60, PDF.su + ySep); });
      y += prima;
    }
    posizioni.set(canto.id, { pagina: pagine.length - 1, y, k });
    for (const r of righe) {
      const yr = y;
      pagine[pagine.length - 1].push(d => r.disegna(d, PDF.su + yr));
      y += r.h;
    }
  }
  return { pagine, posizioni };
}

async function immagineCopertina() {
  const blob = await (await fetch("icone/copertina.jpg")).blob();
  return new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
}

/** Legge un'immagine scelta dall'utente e la rimpicciolisce (lato lungo al massimo 1600 px, JPEG):
    il PDF resta leggero e la foto non lascia il dispositivo. Risponde { dati, w, h }. */
async function leggiLocandina(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const f = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * f), h = Math.round(img.naturalHeight * f);
    const tela = document.createElement("canvas");
    tela.width = w; tela.height = h;
    const cx = tela.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);  // i PNG trasparenti hanno lo sfondo bianco
    cx.drawImage(img, 0, 0, w, h);
    return { dati: tela.toDataURL("image/jpeg", .88), w, h };
  } finally { URL.revokeObjectURL(url); }
}

/** Indice compatto: tre colonne (per tutti i canti sta in una pagina), una sola per le scalette corte. */
function schemaIndice(quanti) {
  const colonne = quanti > 25 ? 3 : 1;
  const altoIndice = PDF.H - PDF.su - PDF.giu - 26;
  const passo = Math.max(9.5, Math.min(14, altoIndice / Math.ceil(quanti / colonne)));
  const righePerColonna = Math.floor(altoIndice / passo);
  const perPaginaIndice = colonne * righePerColonna;
  return { colonne, passo, righePerColonna, perPaginaIndice, pagineIndice: Math.max(1, Math.ceil(quanti / perPaginaIndice)) };
}

/* le scelte dell'ultimo PDF restano per il prossimo (su questo dispositivo) */
const SCELTE_PDF = "canti-pdf-scelte";
function scelteSalvate() {
  const base = { versione: "accordi", copertina: true, preghiere: true };
  try { return { ...base, ...JSON.parse(localStorage.getItem(SCELTE_PDF) || "{}") }; } catch { return base; }
}

/** Chiede come fare il PDF: versione (con accordi o solo testo), copertina sì/no, preghiere allo Spirito sì/no
    e quali canti (tutti spuntati all'inizio). pagine(scelte) dice quante pagine verrebbero.
    Risponde le scelte ({ versione, copertina, preghiere, ids }), o null se si annulla. */
function sceltaPDF(pagine, conPreghiere, canti) {
  return new Promise(risolvi => {
    const d = $("finestra");
    const scelte = scelteSalvate();
    if (!conPreghiere) scelte.preghiere = false;
    scelte.ids = new Set(canti.map(c => c.id));  // i canti non si ricordano: ogni PDF parte da tutti
    let chiusa = false;
    const chiudi = risposta => {
      if (chiusa) return;
      chiusa = true;
      if (d.open) d.close();
      if (risposta) try {
        const { versione, copertina, preghiere } = risposta;
        localStorage.setItem(SCELTE_PDF, JSON.stringify({ versione, copertina, preghiere }));
      } catch { /* resta per questa volta */ }
      risolvi(risposta);
    };
    // le due versioni: si tocca quella che si vuole (resta evidenziata)
    const voci = el("div", "scelte-pdf");
    voci.setAttribute("role", "radiogroup");
    voci.setAttribute("aria-label", "Versione");
    const contatori = {};
    const voce = (valore, titolo, spiega) => {
      const b = el("button", "scelta-pdf");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.valore = valore;
      contatori[valore] = el("small");
      b.append(el("b", null, titolo), el("span", null, spiega), contatori[valore]);
      b.onclick = () => { scelte.versione = valore; aggiorna(); };
      return b;
    };
    voci.append(
      voce("accordi", "🎸 Con accordi", "accordi, melodia e tonalità: per chi suona"),
      voce("testo", "📝 Solo testo", "solo le parole: per chi canta"));
    // le parti in più
    const spunta = (chiave, testo) => {
      const etichetta = el("label", "spunta-pdf");
      const casella = el("input");
      casella.type = "checkbox";
      casella.checked = scelte[chiave];
      casella.onchange = () => { scelte[chiave] = casella.checked; aggiorna(); };
      etichetta.append(casella, document.createTextNode(" " + testo));
      return etichetta;
    };
    const parti = el("div", "parti-pdf");
    parti.append(spunta("copertina", "Copertina"));
    // locandina: al posto della copertina di serie; l'immagine resta sul dispositivo, non si ricorda
    const locandina = el("div", "locandina-pdf");
    const fileLocandina = el("input");
    fileLocandina.type = "file"; fileLocandina.accept = "image/*"; fileLocandina.hidden = true;
    const scegli = el("button", null);
    const togli = el("button", null, "Togli");
    scegli.type = togli.type = "button";
    const miniatura = el("img", "miniatura-pdf");
    miniatura.alt = "Anteprima della locandina";
    const nota = el("small", "nota-locandina");
    scegli.onclick = () => fileLocandina.click();
    togli.onclick = () => { scelte.locandina = null; nota.textContent = ""; aggiorna(); };
    fileLocandina.onchange = async () => {
      const f = fileLocandina.files[0];
      fileLocandina.value = "";
      if (!f) return;
      try { scelte.locandina = await leggiLocandina(f); nota.textContent = f.name; }
      catch { nota.textContent = "Non riesco a leggere questa immagine: prova con una foto JPG o PNG."; }
      aggiorna();
    };
    locandina.append(scegli, togli, fileLocandina, miniatura, nota);
    parti.append(locandina);
    if (conPreghiere) parti.append(spunta("preghiere", "Preghiere allo Spirito Santo (all'inizio e in fondo)"));

    // i canti: tutti spuntati, si toglie quello che non serve
    const caselleCanti = [];
    const quanti = el("span", "conta-canti-pdf");
    const tutti = el("button", null, "Tutti"), nessuno = el("button", null, "Nessuno");
    tutti.type = nessuno.type = "button";
    const segnaTutti = acceso => {
      for (const c of caselleCanti) c.checked = acceso;
      scelte.ids = new Set(acceso ? canti.map(c => c.id) : []);
      aggiorna();
    };
    tutti.onclick = () => segnaTutti(true);
    nessuno.onclick = () => segnaTutti(false);
    const testaCanti = el("div", "testa-canti-pdf");
    testaCanti.append(quanti, tutti, nessuno);
    const lista = el("div", "lista-canti-pdf");
    canti.forEach((c, i) => {
      const etichetta = el("label", "spunta-pdf");
      const casella = el("input");
      casella.type = "checkbox";
      casella.checked = true;
      casella.onchange = () => { if (casella.checked) scelte.ids.add(c.id); else scelte.ids.delete(c.id); aggiorna(); };
      caselleCanti.push(casella);
      etichetta.append(casella, document.createTextNode(` ${i + 1}. ${c.meta.title}`));
      lista.append(etichetta);
    });

    const scarica = el("button", "primario", "Scarica il PDF");
    const annulla = el("button", null, "Annulla");
    scarica.type = annulla.type = "button";

    // le pagine si ricontano un attimo dopo l'ultimo tocco (con tutti i canti ci vuole un momento)
    let timerConto = null;
    const aggiorna = () => {
      for (const b of voci.children) b.setAttribute("aria-checked", b.dataset.valore === scelte.versione);
      locandina.hidden = !scelte.copertina;
      scegli.textContent = scelte.locandina ? "🖼 Cambia locandina…" : "🖼 Aggiungi una locandina…";
      togli.hidden = miniatura.hidden = !scelte.locandina;
      if (scelte.locandina) miniatura.src = scelte.locandina.dati;
      quanti.textContent = `Canti: ${scelte.ids.size} di ${canti.length}`;
      scarica.disabled = !scelte.ids.size;
      clearTimeout(timerConto);
      if (!scelte.ids.size) { for (const v in contatori) contatori[v].textContent = "nessun canto scelto"; return; }
      timerConto = setTimeout(() => {
        for (const v of ["accordi", "testo"]) {
          const n = pagine({ ...scelte, versione: v });
          contatori[v].textContent = `${n} ${n === 1 ? "pagina" : "pagine"}`;
        }
      }, 120);
    };
    aggiorna();

    scarica.onclick = () => chiudi({ ...scelte });
    annulla.onclick = () => chiudi(null);
    const comandi = el("div", "editor-comandi comandi-pdf");  // restano in fondo alla finestra anche scorrendo
    comandi.append(scarica, annulla);
    const box = el("div");
    box.append(el("h3", null, "Quale PDF?"), voci, parti, testaCanti, lista, comandi);
    d.replaceChildren(box);
    d.oncancel = e => { e.preventDefault(); chiudi(null); };  // tasto Esc
    d.onclose = () => chiudi(null);
    d.showModal();
    scarica.focus();
  });
}

/** Crea e scarica il PDF. canti: in ordine; titolo: nome della scaletta (o vuoto per tutti i canti).
    Prima si sceglie: con gli accordi o solo testo, con o senza copertina, con o senza le preghiere allo Spirito. */
async function scaricaPDF(canti, titolo = "", sottotitolo = "") {
  if (!canti.length) { avviso("Nessun canto da mettere nel PDF."); return; }
  avviso(`Preparo il PDF con ${canti.length} ${canti.length === 1 ? "canto" : "canti"}…`);
  try {
    await caricaJsPDF();
  } catch {
    avviso("Per il primo PDF serve la connessione: riprova quando sei online.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a5", compress: true });
  const oggi = new Date().toLocaleDateString("it-IT");
  const preghieraInizio = PREGHIERE.find(p => p.meta.preghiera === "inizio");
  const preghieraFine = PREGHIERE.find(p => p.meta.preghiera === "fine");
  const conPreghiere = !!(preghieraInizio || preghieraFine);
  // pagine prima dell'indice e in fondo, secondo le scelte
  const schema = s => ({
    prima: (s.copertina ? 1 : 0) + (s.preghiere && preghieraInizio ? 1 : 0),
    fine: s.preghiere && preghieraFine ? 1 : 0,
  });
  // quante pagine verrebbero: si impaginano i canti scelti (con la memoria, per non rifare lo stesso conto)
  const contati = new Map();
  const pagineCanti = (scelti, versione) => {
    const chiave = versione + "|" + scelti.map(c => c.id).join(",");
    if (!contati.has(chiave)) contati.set(chiave, impagina(doc, scelti, versione === "testo").pagine.length);
    return contati.get(chiave);
  };
  const totale = s => {
    const scelti = canti.filter(c => s.ids.has(c.id));
    const { prima, fine } = schema(s);
    return prima + schemaIndice(scelti.length).pagineIndice + pagineCanti(scelti, s.versione) + fine;
  };
  const scelte = await sceltaPDF(totale, conPreghiere, canti);
  if (!scelte) return;
  canti = canti.filter(c => scelte.ids.has(c.id));  // da qui in poi: solo i canti spuntati, nel loro ordine
  const soloTesto = scelte.versione === "testo";

  // 1. impaginazione dei canti (serve prima, per scrivere nell'indice i numeri di pagina)
  const { pagine, posizioni } = impagina(doc, canti, soloTesto);
  const { colonne, passo, righePerColonna, perPaginaIndice, pagineIndice } = schemaIndice(canti.length);
  const INDICE = schema(scelte).prima + 1;  // numero della prima pagina dell'indice
  const primaCanti = INDICE + pagineIndice;
  // la prima pagina c'è già nel documento: si usa quella, poi se ne aggiungono
  let paginaVuota = true;
  const nuovaPagina = () => { if (paginaVuota) paginaVuota = false; else doc.addPage(); };
  const piede = numero => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...PDF.rosso);
    // "indice": grande da toccare, porta alla prima pagina dell'indice
    doc.text("indice", PDF.L / 2, PDF.H - 20, { align: "center" });
    doc.link(PDF.L / 2 - 40, PDF.H - 36, 80, 26, { pageNumber: INDICE });
    doc.setTextColor(...PDF.grigio); doc.setFontSize(8);
    doc.text(String(numero), numero % 2 ? PDF.L - PDF.dx : PDF.sx, PDF.H - 20, { align: numero % 2 ? "right" : "left" });
  };

  // 2. copertina (se scelta)
  if (scelte.copertina && scelte.locandina) {
    // la locandina occupa la pagina intera, tutta visibile (senza tagliare)
    nuovaPagina();
    const { dati, w, h } = scelte.locandina;
    const f = Math.min(PDF.L / w, PDF.H / h);
    doc.addImage(dati, "JPEG", (PDF.L - w * f) / 2, (PDF.H - h * f) / 2, w * f, h * f);
  } else if (scelte.copertina) {
    nuovaPagina();
    doc.setFont("times", "bold"); doc.setFontSize(24); doc.setTextColor(0, 0, 0);
    doc.text("Chi canta prega due volte", PDF.L / 2, 92, { align: "center" });
    doc.setFont("times", "italic"); doc.setFontSize(12); doc.setTextColor(...PDF.grigio);
    doc.text("Sant'Agostino", PDF.L / 2, 112, { align: "center" });
    try {
      const lato = 250;
      doc.addImage(await immagineCopertina(), "JPEG", (PDF.L - lato) / 2, 140, lato, lato * 869 / 900);
    } catch { /* senza immagine resta il titolo */ }
    if (titolo) {
      doc.setFont("times", "bold"); doc.setFontSize(15); doc.setTextColor(...PDF.rosso);
      doc.text(pulisci(titolo), PDF.L / 2, 430, { align: "center", maxWidth: PDF.larghezza });
    }
    if (sottotitolo) {
      doc.setFont("times", "italic"); doc.setFontSize(11); doc.setTextColor(...PDF.grigio);
      doc.text(pulisci(sottotitolo), PDF.L / 2, 450, { align: "center", maxWidth: PDF.larghezza });
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...PDF.grigio);
    doc.text(`${canti.length} ${canti.length === 1 ? "canto" : "canti"}${soloTesto ? " · solo testo" : ""}`, PDF.L / 2, PDF.H - 30, { align: "center" });
  }

  // 3. preghiere (se scelte)
  const preghiera = (p, numero) => {
    nuovaPagina();
    let y = 110;
    doc.setFont("times", "bold"); doc.setFontSize(16); doc.setTextColor(0, 0, 0);
    doc.text(pulisci(p.meta.title), PDF.L / 2, y, { align: "center" });
    y += 34;
    doc.setFont("times", "italic"); doc.setFontSize(11.5);
    for (const b of p.blocchi) {
      for (const r of b.righe || []) {
        if (r.commento) continue;
        for (const v of doc.splitTextToSize(pulisci(r), PDF.larghezza - 20)) { doc.text(v, PDF.L / 2, y, { align: "center" }); y += 15; }
      }
      y += 9;
    }
    piede(numero);
  };
  if (scelte.preghiere && preghieraInizio) preghiera(preghieraInizio, INDICE - 1);

  // 4. indice: ogni voce porta al suo canto; in ordine dall'alto in basso, colonna per colonna
  const numerato = !!titolo;  // per una scaletta: l'ordine della scaletta, numerato
  const spazioColonne = 10;
  const largaColonna = (PDF.larghezza - spazioColonne * (colonne - 1)) / colonne;
  const corpo = colonne > 1 ? Math.min(8.5, passo * .75) : 11;
  for (let k = 0; k < pagineIndice; k++) {
    nuovaPagina();
    if (k === 0) {
      // senza copertina, il nome della scaletta va in cima all'indice
      const intestazione = !scelte.copertina && titolo ? titolo : "Indice";
      doc.setFont("times", "bold"); doc.setFontSize(14); doc.setTextColor(0, 0, 0);
      let testa = pulisci(intestazione);
      while (testa.length > 3 && doc.getTextWidth(testa) > PDF.larghezza) testa = testa.slice(0, -2).trimEnd() + "…";
      doc.text(testa, PDF.sx, PDF.su + 10);
      if (!scelte.copertina && titolo && sottotitolo) {
        const x = PDF.sx + doc.getTextWidth(testa) + 8;
        doc.setFont("times", "italic"); doc.setFontSize(10); doc.setTextColor(...PDF.grigio);
        const resto = PDF.L - PDF.dx - x;
        if (resto > 40) doc.text(doc.splitTextToSize(pulisci(sottotitolo), resto)[0], x, PDF.su + 10);
      }
    }
    canti.slice(k * perPaginaIndice, (k + 1) * perPaginaIndice).forEach((c, i) => {
      const pos = posizioni.get(c.id);
      const pagina = String(primaCanti + pos.pagina);
      const x = PDF.sx + Math.floor(i / righePerColonna) * (largaColonna + spazioColonne);
      const y = PDF.su + 26 + (i % righePerColonna) * passo + corpo;
      doc.setFont("helvetica", "normal"); doc.setFontSize(corpo * .9); doc.setTextColor(...PDF.grigio);
      const largaPagina = doc.getTextWidth(pagina);
      doc.text(pagina, x + largaColonna, y, { align: "right" });
      doc.setFont("times", "normal"); doc.setFontSize(corpo); doc.setTextColor(0, 0, 0);
      let nome = pulisci((numerato ? `${k * perPaginaIndice + i + 1}. ` : "") + c.meta.title);
      const spazio = largaColonna - largaPagina - 4;
      if (doc.getTextWidth(nome) > spazio) {  // titolo troppo lungo per la colonna: si accorcia
        while (nome.length > 3 && doc.getTextWidth(nome + "…") > spazio) nome = nome.slice(0, -1);
        nome = nome.trimEnd() + "…";
      }
      doc.text(nome, x, y);
      // tutta la voce si tocca
      doc.link(x - 2, y - corpo, largaColonna + 4, passo, { pageNumber: Number(pagina), magFactor: "XYZ", top: Math.max(0, PDF.su + pos.y - 6) });
    });
    piede(INDICE + k);
  }

  // 5. canti, con il segnalibro di ognuno (pannello laterale del lettore PDF)
  pagine.forEach((operazioni, i) => {
    nuovaPagina();
    for (const f of operazioni) f(doc);
    piede(primaCanti + i);
  });
  for (const c of canti) doc.outline.add(null, pulisci(c.meta.title), { pageNumber: primaCanti + posizioni.get(c.id).pagina });

  // 6. preghiera finale
  if (scelte.preghiere && preghieraFine) preghiera(preghieraFine, primaCanti + pagine.length);

  // in fondo all'ultima pagina, a destra: quando è stato scaricato
  doc.setPage(doc.getNumberOfPages());
  doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(...PDF.grigio);
  doc.text(`Scaricato il ${oggi}`, PDF.L - PDF.dx, PDF.H - 34, { align: "right" });

  const nomeFile = ("Chi canta prega due volte" + (titolo ? " - " + titolo : "") + (soloTesto ? " (solo testo)" : "")).replace(/[\\/:*?"<>|]/g, "") + ".pdf";
  doc.save(nomeFile);
}

$("pdf-elenco").onclick = () => {
  const filtrato = ELENCO !== CANTI;
  scaricaPDF(ELENCO, filtrato ? "Canti scelti" : "", filtrato ? stato.filtri.join(" · ") : "");
};
