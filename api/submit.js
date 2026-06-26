// Backend serverless (Vercel) — réception du dossier de constitution.
// Reçoit le POST du formulaire, envoie un e-mail récapitulatif avec les pièces jointes via Resend.
// Variables d'environnement à définir dans Vercel :
//   RESEND_API_KEY  (obligatoire)  — clé API Resend
//   MAIL_TO         (obligatoire)  — e-mail du destinataire (ex. h.toledano@aticoexpertise.fr)
//   MAIL_FROM       (optionnel)    — expéditeur ; défaut "Atico Finance <onboarding@resend.dev>"

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function row(k, v) { return `<tr><td style="color:#6b7689;padding:3px 14px 3px 0;vertical-align:top">${esc(k)}</td><td style="font-weight:600">${esc(v) || '—'}</td></tr>`; }
function h4(t) { return `<h3 style="margin:18px 0 6px;color:#16204e;font-size:15px">${esc(t)}</h3>`; }

function buildHtml(d) {
  const s = d.societe || {};
  let h = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c2433;font-size:14px;line-height:1.5">
    <h2 style="color:#16204e">Nouveau dossier de constitution</h2>
    <p><b>Dossier :</b> ${esc(d.dossier)} &nbsp;·&nbsp; <b>Client :</b> ${esc(d.client) || '—'} &nbsp;·&nbsp; reçu le ${esc((d.submittedAt || '').slice(0, 16).replace('T', ' '))}</p>`;
  h += h4('Société') + '<table cellpadding="0" cellspacing="0">' +
    row('Dénomination', s.denomination) + row('Alternatives', s.alternatives) +
    row('Forme / régime', `${s.forme || ''} — ${(s.regime || '').split('—')[0].trim()}`) +
    row('Capital', (s.capital || '') + ' €') + row('Clôture', s.cloture) +
    row('Siège social', s.adresseSiege) + row('Nature du siège', s.natureSiege) +
    row('Banque retenue', d.banque) + '</table>';

  (d.associes || []).forEach((a, i) => {
    h += h4(`Associé ${i + 1}`) + '<table cellpadding="0" cellspacing="0">';
    if (a.type === 'Personne morale') {
      h += row('Type', 'Personne morale') + row('Dénomination', a.pmDenomination) + row('SIREN', a.pmSiren) +
        row('Forme', a.pmForme) + row('Siège', a.pmAdresseSiege) +
        row('Représentant', `${a.pmRepPrenom || ''} ${a.pmRepNom || ''} (${a.pmRepQualite || ''})`) + row('Parts', (a.parts || '') + ' %');
    } else {
      h += row('Identité', `${a.civilite || ''} ${a.prenom || ''} ${a.autresPrenoms || ''} ${a.nom || ''}`.replace(/\s+/g, ' ').trim()) +
        row('Nom de naissance', a.nomNaissance) +
        row('Né(e) le', `${a.dateNaissance || ''} à ${a.villeNaissance || ''} (${a.paysNaissance || ''})`) +
        row('Nationalité', a.nationalite) + row('Statut matrimonial', a.statutMatrimonial) +
        (a.regimeMatrimonial ? row('Régime / convention', a.regimeMatrimonial) : '') +
        ((a.conjointNom || a.conjointPrenom) ? row('Conjoint', `${a.conjointPrenom || ''} ${a.conjointNom || ''}`) : '') +
        row('Adresse', `${a.adresse || ''}, ${a.cp || ''} ${a.ville || ''} ${a.pays || ''}`) +
        row('Parts', (a.parts || '') + ' %') +
        row('Contact', `${a.email || ''} ${a.telephone ? '· ' + (a.indicatif || '') + ' ' + a.telephone : ''}`);
    }
    h += '</table>';
  });

  (d.mandataires || []).forEach((m, i) => {
    h += h4(`Mandataire ${i + 1}`) + '<table cellpadding="0" cellspacing="0">' +
      row('Nom & prénom', `${m.prenom || ''} ${m.nom || ''}`) + row('Fonction', m.fonction) +
      (m.rpps ? row('N° RPPS', m.rpps) : '') + '</table>';
  });

  (d.parents || []).forEach((p) => {
    if (p.pere || p.mere) h += h4(`Parents de ${p.mandataire || ''}`) + '<table cellpadding="0" cellspacing="0">' +
      row('Père', p.pere) + row('Mère', p.mere) + '</table>';
  });

  const docs = d.documents || [];
  h += h4('Pièces jointes') + `<p>${docs.length} fichier(s) joint(s) à cet e-mail.</p>`;
  h += `</div>`;
  return h;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_TO) {
    return res.status(500).json({ error: 'Configuration manquante : définissez RESEND_API_KEY et MAIL_TO dans Vercel.' });
  }
  try {
    const d = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const documents = Array.isArray(d.documents) ? d.documents : [];
    const attachments = documents
      .filter(x => x && x.filename && x.contentBase64)
      .map(x => ({ filename: x.filename, content: x.contentBase64 }));

    const subject = `Nouveau dossier de constitution — ${(d.societe && d.societe.denomination) || d.client || d.dossier || ''}`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Atico Finance <onboarding@resend.dev>',
        to: [process.env.MAIL_TO],
        subject,
        html: buildHtml(d),
        attachments
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "Échec de l'envoi de l'e-mail", detail });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
