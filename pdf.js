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

/** Indice compatto: tre colonne (per tutti i canti sta in una pagina), una sola per le scalette corte. */
function schemaIndice(quanti) {
  const colonne = quanti > 25 ? 3 : 1;
  const altoIndice = PDF.H - PDF.su - PDF.giu - 26;
  const passo = Math.max(9.5, Math.min(14, altoIndice / Math.ceil(quanti / colonne)));
  const righePerColonna = Math.floor(altoIndice / passo);
  const perPaginaIndice = colonne * righePerColonna;
  return { colonne, passo, righePerColonna, perPaginaIndice, pagineIndice: Math.max(1, Math.ceil(quanti / perPaginaIndice)) };
}

/** Chiede quale PDF: con gli accordi o solo il testo, ognuno con le sue pagine. Risponde "accordi", "testo" o null. */
function sceltaVersione(pagineAccordi, pagineTesto) {
  return new Promise(risolvi => {
    const d = $("finestra");
    let chiusa = false;
    const chiudi = risposta => {
      if (chiusa) return;
      chiusa = true;
      if (d.open) d.close();
      risolvi(risposta);
    };
    const voce = (valore, titolo, spiega, pagine) => {
      const b = el("button", "scelta-pdf");
      b.type = "button";
      b.append(el("b", null, titolo), el("span", null, spiega), el("small", null, `${pagine} pagine`));
      b.onclick = () => chiudi(valore);
      return b;
    };
    const annulla = el("button", null, "Annulla");
    annulla.type = "button";
    annulla.onclick = () => chiudi(null);
    const comandi = el("div", "editor-comandi");
    comandi.append(annulla);
    const voci = el("div", "scelte-pdf");
    voci.append(
      voce("accordi", "🎸 Con accordi", "accordi, melodia e tonalità: per chi suona", pagineAccordi),
      voce("testo", "📝 Solo testo", "solo le parole: per chi canta, meno pagine da stampare", pagineTesto));
    const box = el("div");
    box.append(el("h3", null, "Quale PDF?"), voci, comandi);
    d.replaceChildren(box);
    d.oncancel = e => { e.preventDefault(); chiudi(null); };  // tasto Esc
    d.onclose = () => chiudi(null);
    d.showModal();
  });
}

/** Crea e scarica il PDF. canti: in ordine; titolo: nome della scaletta (o vuoto per tutti i canti).
    Prima si sceglie la versione: con gli accordi o solo testo. */
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
  const { colonne, passo, righePerColonna, perPaginaIndice, pagineIndice } = schemaIndice(canti.length);

  // 1. impaginazione dei canti nelle due versioni (serve prima: per contare le pagine e per i numeri dell'indice)
  const versioni = { accordi: impagina(doc, canti), testo: impagina(doc, canti, true) };
  const totale = v => 2 + pagineIndice + v.pagine.length + (preghieraFine ? 1 : 0);
  const scelta = await sceltaVersione(totale(versioni.accordi), totale(versioni.testo));
  if (!scelta) return;
  const soloTesto = scelta === "testo";
  const { pagine, posizioni } = versioni[scelta];
  const INDICE = 3;  // copertina, preghiera, indice
  const primaCanti = INDICE + pagineIndice;
  const piede = numero => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...PDF.rosso);
    // "indice": grande da toccare, porta alla prima pagina dell'indice
    doc.text("indice", PDF.L / 2, PDF.H - 20, { align: "center" });
    doc.link(PDF.L / 2 - 40, PDF.H - 36, 80, 26, { pageNumber: INDICE });
    doc.setTextColor(...PDF.grigio); doc.setFontSize(8);
    doc.text(String(numero), numero % 2 ? PDF.L - PDF.dx : PDF.sx, PDF.H - 20, { align: numero % 2 ? "right" : "left" });
  };

  // 2. copertina
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

  // 3. preghiere
  const preghiera = (p, numero) => {
    doc.addPage();
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
  if (preghieraInizio) preghiera(preghieraInizio, 2);
  else { doc.addPage(); piede(2); }

  // 4. indice: ogni voce porta al suo canto; in ordine dall'alto in basso, colonna per colonna
  const numerato = !!titolo;  // per una scaletta: l'ordine della scaletta, numerato
  const spazioColonne = 10;
  const largaColonna = (PDF.larghezza - spazioColonne * (colonne - 1)) / colonne;
  const corpo = colonne > 1 ? Math.min(8.5, passo * .75) : 11;
  for (let k = 0; k < pagineIndice; k++) {
    doc.addPage();
    if (k === 0) {
      doc.setFont("times", "bold"); doc.setFontSize(14); doc.setTextColor(0, 0, 0);
      doc.text("Indice", PDF.sx, PDF.su + 10);
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
    doc.addPage();
    for (const f of operazioni) f(doc);
    piede(primaCanti + i);
  });
  for (const c of canti) doc.outline.add(null, pulisci(c.meta.title), { pageNumber: primaCanti + posizioni.get(c.id).pagina });

  // 6. preghiera finale
  if (preghieraFine) preghiera(preghieraFine, primaCanti + pagine.length);

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
