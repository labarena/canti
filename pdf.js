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

/** Prepara le righe di un canto (misurate ma non ancora disegnate): ciascuna { h, disegna(doc, y), unita } */
function righeCanto(doc, canto) {
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
  font("bold", 14);
  for (const r of doc.splitTextToSize(pulisci(m.title), PDF.larghezza)) metti(17, (d, y) => { font("bold", 14); d.text(r, PDF.sx, y + 13); }, true);
  const dettagli = [m.subtitle, m.artist].filter(Boolean).join(" · ");
  if (dettagli) metti(11, (d, y) => { font("italic", 8.5, PDF.grigio); d.text(pulisci(dettagli), PDF.sx, y + 8.5); }, true);
  const { bpm, metro } = tempoMetronomo(canto);
  const info = [m.key && "Tonalità " + nomeTonalita(canto, n), metro, bpm && "ritmo " + bpm].filter(Boolean).join(" · ");
  if (info) metti(11, (d, y) => { font("normal", 7.5, PDF.grigio, "helvetica"); d.text(pulisci(info), PDF.sx, y + 8); }, true);
  for (const b of canto.blocchi) {
    if (b.tipo !== "melodia" || /start_of_abc/i.test(b.sorgente)) continue;
    const note = [...b.sorgente.matchAll(/^\s*note\s*:(.*)$/gim)].map(x => x[1].trim()).filter(Boolean).join("  ");
    if (note) {
      font("italic", 8);
      for (const r of doc.splitTextToSize(pulisci("Melodia: " + note), PDF.larghezza))
        metti(10, (d, y) => { font("italic", 8, PDF.grigio); d.text(r, PDF.sx, y + 8); }, true);
    }
  }
  metti(4, () => {}, true);

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
      doc.setFont("times", stile); doc.setFontSize(11);
      const tw = doc.getTextWidth(pulisci(testo));
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
      const cw = accordo ? doc.getTextWidth(acc(accordo)) + 3 : 0;
      return { tw, cw, w: Math.max(tw, cw) };
    };
    doc.setFont("times", stile); doc.setFontSize(11);
    const spazio = doc.getTextWidth(" ");
    const visive = [[]];
    let xCur = 0;
    const max = PDF.larghezza - rientro;
    for (const parola of parole) {
      const pezzi = parola.map(([a, t]) => ({ a, t, ...misura(t, a) }));
      const w = pezzi.reduce((s, p) => s + p.w, 0);
      if (xCur > 0 && xCur + w > max) { visive.push([]); xCur = 12; }  // a capo, un po' rientrato
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
      const h = (conAccordi ? PDF.rigaAccordi : 0) + (conTesto ? PDF.rigaTesto : 3);
      metti(h, (d, y) => {
        const yAcc = y + 8, yTesto = y + (conAccordi ? PDF.rigaAccordi : 0) + 10;
        for (const p of pezzi) {
          const x0 = PDF.sx + rientro + p.x;
          if (p.a) { d.setFont("helvetica", "bold"); d.setFontSize(8.5); d.setTextColor(...PDF.rosso); d.text(acc(p.a), x0, yAcc); }
          if (p.t) { d.setFont("times", stile); d.setFontSize(11); d.setTextColor(0, 0, 0); d.text(pulisci(p.t), x0, yTesto); }
          if (p.trattino) {  // l'accordo allarga la parola: un trattino ricuce le sillabe
            d.setTextColor(...PDF.grigio); d.text("-", x0 + p.tw + (p.w - p.tw) / 2 - 1.5, yTesto);
          }
        }
      });
    }
  };

  for (const b of canto.blocchi) {
    if (["verso", "libero", "ritornello", "ponte"].includes(b.tipo)) {
      const rit = b.tipo === "ritornello";
      const rientro = rit ? 20 : 0;
      const inizio = righe.length;
      for (const r of b.righe) {
        if (r.commento) metti(11, (d, y) => { font("italic", 8.5, PDF.grigio); d.text(pulisci(r.commento), PDF.sx + rientro, y + 8.5); });
        else rigaConAccordi(r, rientro, rit ? "italic" : "normal");
      }
      if (rit && righe[inizio]) {  // "Rit." accanto alla prima riga del ritornello
        const prima = righe[inizio].disegna;
        righe[inizio].disegna = (d, y) => {
          prima(d, y);
          font("bold", 7, PDF.rosso, "helvetica");
          d.text("Rit.", PDF.sx, y + righe[inizio].h - 3);
        };
      }
      metti(PDF.spazioBlocco, () => {});
    } else if (b.tipo === "rif-ritornello") {
      metti(14, (d, y) => { font("bold", 8, PDF.rosso, "helvetica"); d.text("Rit.", PDF.sx, y + 9); });
    } else if (b.tipo === "sequenza") {
      const testo = (b.etichetta ? b.etichetta + ":  " : "") + b.accordi.map(acc).join("   ");
      font("bold", 8.5, PDF.rosso, "helvetica");
      for (const r of doc.splitTextToSize(pulisci(testo), PDF.larghezza))
        metti(12, (d, y) => { font("bold", 8.5, PDF.rosso, "helvetica"); d.text(r, PDF.sx, y + 9); });
      metti(PDF.spazioBlocco / 2, () => {});
    } else if (b.tipo === "commento") {
      metti(12, (d, y) => { font("italic", 9, PDF.grigio); d.text(pulisci(b.testo), PDF.sx, y + 9); });
    }
  }
  return righe;
}

/** Distribuisce i canti nelle pagine: un canto corto non si spezza; se non ci sta, va alla pagina dopo. */
function impagina(doc, canti) {
  const alto = PDF.H - PDF.su - PDF.giu;
  const pagine = [[]];
  let y = 0;
  const posizioni = new Map();
  for (const canto of canti) {
    const righe = righeCanto(doc, canto);
    while (righe.length && righe[righe.length - 1].h <= PDF.spazioBlocco && !righe[righe.length - 1].unita) righe.pop();
    const totale = righe.reduce((s, r) => s + r.h, 0);
    const prima = y > 0 ? PDF.spazioCanti : 0;
    if (y > 0 && (y + prima + totale > alto)) {
      // non ci sta: pagina nuova (anche se è lungo, almeno comincia in cima)
      pagine.push([]); y = 0;
    } else if (y > 0) {
      const ySep = y + prima / 2;
      pagine[pagine.length - 1].push(d => { d.setDrawColor(210, 200, 190); d.setLineWidth(.5); d.line(PDF.sx + 60, PDF.su + ySep, PDF.L - PDF.dx - 60, PDF.su + ySep); });
      y += prima;
    }
    for (const [i, r] of righe.entries()) {
      // a fondo pagina si va a capo pagina; titolo e intestazione restano attaccati alle prime righe del canto
      let serve = r.h;
      if (r.unita) {
        let j = i;
        serve = 0;
        while (j < righe.length && righe[j].unita) serve += righe[j++].h;
        for (let k = 0; k < 2 && j < righe.length; k++) serve += righe[j++].h;
      }
      if (y + serve > alto && y > 0) { pagine.push([]); y = 0; }
      if (i === 0) posizioni.set(canto.id, { pagina: pagine.length - 1, y });
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

/** Crea e scarica il PDF. canti: in ordine; titolo: nome della scaletta (o vuoto per tutti i canti). */
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

  // 1. impaginazione dei canti (serve prima, per scrivere nell'indice i numeri di pagina)
  const { pagine, posizioni } = impagina(doc, canti);
  const perPaginaIndice = Math.floor((PDF.H - PDF.su - PDF.giu - 30) / 14);
  const pagineIndice = Math.max(1, Math.ceil(canti.length / perPaginaIndice));
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
  doc.text(`${canti.length} ${canti.length === 1 ? "canto" : "canti"} · ${oggi}`, PDF.L / 2, PDF.H - 30, { align: "center" });

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
  const preghieraInizio = PREGHIERE.find(p => p.meta.preghiera === "inizio");
  const preghieraFine = PREGHIERE.find(p => p.meta.preghiera === "fine");
  if (preghieraInizio) preghiera(preghieraInizio, 2);
  else { doc.addPage(); piede(2); }

  // 4. indice: ogni riga porta al suo canto
  const numerato = !!titolo;  // per una scaletta: l'ordine della scaletta, numerato
  for (let k = 0; k < pagineIndice; k++) {
    doc.addPage();
    let y = PDF.su + 14;
    if (k === 0) {
      doc.setFont("times", "bold"); doc.setFontSize(16); doc.setTextColor(0, 0, 0);
      doc.text("Indice", PDF.sx, y);
    }
    y += 24;
    for (const [i, c] of canti.slice(k * perPaginaIndice, (k + 1) * perPaginaIndice).entries()) {
      const pos = posizioni.get(c.id);
      const pagina = primaCanti + pos.pagina;
      const nome = pulisci((numerato ? `${k * perPaginaIndice + i + 1}. ` : "") + c.meta.title);
      doc.setFont("times", "normal"); doc.setFontSize(11); doc.setTextColor(0, 0, 0);
      const nomeCorto = doc.splitTextToSize(nome, PDF.larghezza - 40)[0];
      doc.text(nomeCorto, PDF.sx, y);
      const fine = PDF.sx + doc.getTextWidth(nomeCorto) + 4;
      doc.setTextColor(...PDF.grigio);
      doc.text(String(pagina), PDF.L - PDF.dx, y, { align: "right" });
      const finePuntini = PDF.L - PDF.dx - doc.getTextWidth(String(pagina)) - 4;
      doc.setFontSize(8);
      let puntini = "";
      while (doc.getTextWidth(puntini + ". ") < finePuntini - fine) puntini += ". ";
      doc.text(puntini, fine, y);
      // tutta la riga si tocca
      doc.link(PDF.sx - 4, y - 11, PDF.larghezza + 8, 14, { pageNumber: pagina, magFactor: "XYZ", top: Math.max(0, PDF.su + pos.y - 6) });
      y += 14;
    }
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

  const nomeFile = ("Chi canta prega due volte" + (titolo ? " - " + titolo : "")).replace(/[\\/:*?"<>|]/g, "") + ".pdf";
  doc.save(nomeFile);
}

$("pdf-elenco").onclick = () => {
  const filtrato = ELENCO !== CANTI;
  scaricaPDF(ELENCO, filtrato ? "Canti scelti" : "", filtrato ? stato.filtri.join(" · ") : "");
};
