// Bot Facebook IUTAM : Messenger + commentaires + avis. Node >= 18, aucune dépendance.
const http = require('http');
const crypto = require('crypto');

const {
  PORT = 3000, VERIFY_TOKEN, APP_SECRET, PAGE_ACCESS_TOKEN, PAGE_ID,
  SITE_URL = 'https://angeloramiandrisoa55-gif.github.io/iutam-site',
} = process.env;
const GRAPH = 'https://graph.facebook.com/v21.0';

/* ---------- Données du site (cache 1 h) ---------- */
let cache = { t: 0, d: null };
async function getData() {
  if (cache.d && Date.now() - cache.t < 3600e3) return cache.d;
  const get = async (n) => (await fetch(`${SITE_URL}/api/${n}.json`)).json();
  try {
    const [faq, frais, contacts, formations, admissions] = await Promise.all(
      ['faq', 'frais', 'contacts', 'formations', 'admissions'].map(get));
    cache = { t: Date.now(), d: { faq, frais, contacts, formations, admissions } };
  } catch (e) { console.error('Données indisponibles:', e.message); if (!cache.d) throw e; }
  return cache.d;
}

/* ---------- Utilitaires texte ---------- */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('le la les de des du un une et ou a au aux en pour est sont quel quels quelle quelles que qui quoi comment je vous nous il elle y ce cet cette dans sur par avec ny ve amin sy ary'.split(' '));
const tokens = (s) => norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
const isMg = (s) => /\b(ny|ve|ohatrinona|inona|aiza|azafady|miarahaba|salama|manao ahoana|mba|ahoana|iza|firy|saram)\b/i.test(s);
const ar = (n) => n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ') + ' Ar';

/* ---------- Intentions (mots-clés -> réponse construite depuis les JSON) ---------- */
function intents(d, mg) {
  const c = d.contacts, f = d.frais;
  const commun = f.communs.reduce((s, x) => s + x.montant, 0);
  const lignes = f.niveaux.map((n) => `• ${n.nom.fr} : ${ar(commun + 3 * n.tranche)}/an (${ar(n.tranche)} × 3 tranches + ${ar(commun)} de frais communs)`).join('\n');
  const parcours = d.formations.items;
  return [
    { k: /\b(frais|prix|tarif|cout|combien|scolarite|payer|paiement|saram|ohatrinona|firy)\b/,
      r: `💰 Frais de scolarité (à titre indicatif) :\n${lignes}\n\nFrais communs : ` + f.communs.map((x) => `${x.designation.fr} ${ar(x.montant)}`).join(', ') + `.\nDétails : ${SITE_URL}` },
    { k: /\b(adresse|ou etes|situe|localisation|campus|venir|trouver|aiza)\b/,
      r: `📍 ${c.siege.adresse.fr}, ${c.siege.ville.fr} ${c.siege.code_postal}, ${c.siege.pays.fr}.` },
    { k: /\b(telephone|tel|appeler|numero|contact|joindre|mail|email|ecrire|secretariat)\b/,
      r: `📞 ${c.siege.telephone}\n✉️ ${c.siege.email}\n📍 ${c.siege.adresse.fr}, ${c.siege.ville.fr}\n🌐 ${SITE_URL}` },
    { k: /\b(formation|formations|parcours|licence|master|ingeniorat|filiere|mention|diplome|lilan)\b/,
      r: `🎓 Formations de l'IUTAM :\n` + parcours.map((p) => `• ${p.nom.fr} (${p.niveau === 'licence' ? 'Licence Pro' : 'Ingéniorat Master'}, ${p.duree.fr})`).join('\n') + `\n\nDétails : ${SITE_URL}` },
    { k: /\b(admission|candidater|candidature|inscription|inscrire|dossier|bac|serie|conditions|fidirana)\b/,
      r: `📝 Admission : ouverte aux titulaires du baccalauréat (Licence Pro) ou d'une licence équivalente (Ingéniorat), sélection sur dossier.\n` + d.admissions.items.filter((a) => a.bac_requis && a.niveau && a.niveau.id === 'licence').map((a) => `• ${a.parcours.fr} : bac ${a.bac_requis.fr}`).join('\n') + `\n\nPlus d'infos : ${SITE_URL}` },
    { k: /\b(ferme|laboratoire|labo|wifi|salle|infrastructure|equipement|campus)\b/,
      r: `🏫 L'IUTAM dispose de laboratoires et salles équipées (vidéoprojection, Wi‑Fi) et d'une ferme-école pour la pratique.` },
    { k: /\b(stage|stages)\b/,
      r: `🧑‍🌾 Stages : L1 stage d'imprégnation, L2 stage ouvrier, L3 stage de mémoire, M2 stage de mémoire d'ingéniorat. Ferme-école et laboratoires sur place.` },
  ];
}

/* ---------- Moteur de réponse ---------- */
async function answer(text) {
  const d = await getData();
  const mg = isMg(text), n = ' ' + norm(text) + ' ';
  const salut = /\b(bonjour|bonsoir|salut|hello|salama|manao ahoana)\b/.test(n);

  for (const it of intents(d, mg)) if (it.k.test(n)) return { text: it.r, found: true };

  // Meilleure question de la FAQ par recouvrement de mots
  const qt = new Set(tokens(text));
  let best = null, bs = 0;
  for (const sec of d.faq.items) for (const q of (sec.titre.questions || [])) {
    for (const [qq, rr] of [[q.q, q.r], [q.q_mg, q.r_mg]]) {
      const t = tokens(qq); if (!t.length) continue;
      const s = t.filter((w) => qt.has(w)).length / Math.sqrt(t.length * Math.max(qt.size, 1));
      if (s > bs) { bs = s; best = { r: mg && q.r_mg ? q.r_mg : q.r }; }
    }
  }
  if (best && bs >= 0.4) return { text: best.r, found: true };
  if (salut) return { text: `Bonjour 👋 Bienvenue à l'IUTAM Mahajanga ! Je peux vous renseigner sur les formations, l'admission, les frais, les stages et nos contacts. Posez votre question.`, found: false, greeting: true };
  const c = d.contacts.siege;
  return { text: `Merci pour votre message 🙏 Je n'ai pas la réponse exacte. Notre secrétariat vous répondra : 📞 ${c.telephone} · ✉️ ${c.email} · ${SITE_URL}`, found: false };
}

/* ---------- Appels Graph API ---------- */
async function graph(path, body) {
  const r = await fetch(`${GRAPH}/${path}?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) console.error('Graph', path, r.status, await r.text());
  return r.ok;
}
const sendMessage = (psid, text) => graph('me/messages', { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: text.slice(0, 1900) } });
const replyComment = (id, message) => graph(`${id}/comments`, { message: message.slice(0, 7000) });
const privateReply = (id, message) => graph(`${id}/private_replies`, { message: message.slice(0, 1900) });

/* ---------- Événements ---------- */
const seen = new Set();
const once = (id) => { if (!id || seen.has(id)) return false; seen.add(id); if (seen.size > 5000) seen.clear(); return true; };

async function onMessage(ev) {
  if (!ev.message || ev.message.is_echo || !ev.message.text) return;
  if (!once(ev.message.mid)) return;
  const a = await answer(ev.message.text);
  await sendMessage(ev.sender.id, a.text);
}

async function onChange(ch) {
  const v = ch.value || {};
  // Commentaire sur une publication
  if (ch.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
    if (v.from && v.from.id === PAGE_ID) return;       // ne pas répondre à soi-même
    if (!once(v.comment_id)) return;
    const msg = v.message || '';
    if (!/\?/.test(msg) && !(await answer(msg)).found) return; // ignorer "bravo 👏"
    const a = await answer(msg);
    if (!a.found) return;
    const court = a.text.length > 300 ? a.text.slice(0, 280).replace(/\s+\S*$/, '') + '… 📩 Détails envoyés en message privé.' : a.text;
    await replyComment(v.comment_id, court);
    if (a.text.length > 300) await privateReply(v.comment_id, a.text);
  }
  // Avis / recommandations
  if (ch.field === 'ratings' && v.verb === 'add' && v.open_graph_story_id && once(v.open_graph_story_id)) {
    const pos = v.recommendation_type ? v.recommendation_type === 'positive' : (v.rating || 5) >= 4;
    await replyComment(v.open_graph_story_id, pos
      ? 'Merci beaucoup pour votre confiance ! 🌱 Toute l\'équipe de l\'IUTAM vous souhaite une belle réussite.'
      : 'Merci pour votre retour. Nous sommes désolés que votre expérience n\'ait pas été satisfaisante ; contactez notre secrétariat pour que nous puissions améliorer les choses.');
  }
}

/* ---------- Serveur ---------- */
function validSig(raw, sig) {
  if (!APP_SECRET) return true;
  const h = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  return sig && sig.length === h.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig));
}

if (process.argv.includes('--test')) {
  (async () => {
    for (const q of ['Bonjour', 'Quels sont les frais ?', 'Où êtes-vous situés ?', 'Quelles formations ?', 'Conditions admission bac D ?', 'Ohatrinona ny saram-pianarana?', 'Y a-t-il une ferme-école ?', 'bonne chance ?? blabla']) {
      const a = await answer(q); console.log('\nQ:', q, '\nR:', a.text.slice(0, 400));
    }
  })();
} else {
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'GET' && u.pathname === '/webhook') {
      if (u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
        res.writeHead(200); return res.end(u.searchParams.get('hub.challenge'));
      }
      res.writeHead(403); return res.end();
    }
    if (req.method === 'POST' && u.pathname === '/webhook') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        if (!validSig(raw, req.headers['x-hub-signature-256'])) { res.writeHead(401); return res.end(); }
        res.writeHead(200); res.end('EVENT_RECEIVED');           // répondre vite à Meta
        let body; try { body = JSON.parse(raw); } catch { return; }
        if (body.object !== 'page') return;
        for (const e of body.entry || []) {
          for (const m of e.messaging || []) onMessage(m).catch(console.error);
          for (const c of e.changes || []) onChange(c).catch(console.error);
        }
      });
      return;
    }
    res.writeHead(200); res.end('Bot IUTAM OK');
  }).listen(PORT, () => console.log('Bot IUTAM sur le port', PORT));
}
