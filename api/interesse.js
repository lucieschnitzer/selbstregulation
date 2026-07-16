/**
 * Interest-form endpoint for the Selbstregulations-Programm landing pages.
 *
 * Receives the POST from the #interesse form (urlencoded), formats the
 * answers, and emails them via Resend to both partners. Replaces the
 * never-wired Formspree placeholder (2026-07-16).
 *
 * Env: RESEND_API_KEY (set on the Vercel project).
 */

const RECIPIENTS = ["info@lucieschnitzer.com", "kontakt@schroeder-boese.coach"];
const TEST_RECIPIENTS = ["info@lucieschnitzer.com"]; // `_test` submissions skip Susanne
const FROM = "Selbstregulations-Programm <info@lucieschnitzer.com>";

// The long page also gets embedded on Susanne's own website (cms Morpheus),
// so its fetch-POST arrives cross-origin from her domain.
const ALLOWED_ORIGINS = [
  "https://selbstregulation.vercel.app",
  "https://schroeder-boese.coach",
  "https://www.schroeder-boese.coach",
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
}

const FIELDS = [
  ["Vorname", "Vorname"],
  ["email", "E-Mail"],
  ["F1_Anliegen", "1. Was möchtest Du verändern, und warum jetzt?"],
  ["F2_Stresslevel", "2. Stresslevel an einem normalen Tag (1–10)"],
  ["F3_Stress-Signale", "3. Stress-Signale im Körper"],
  ["F4_Vorerfahrung", "4. Vorerfahrung"],
  ["F5_Passung", "5. Passung 12–15 Wochen (1–5)"],
  ["F5_Bisher_probiert", "5b. Bisher probiert / was gefehlt hat"],
  ["Einverstaendnis", "Einverständnis"],
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asText(v) {
  return Array.isArray(v) ? v.join(", ") : String(v ?? "");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = req.body || {};

  // Honeypot: bots fill every field; humans never see this one.
  if (asText(body.website).trim() !== "") {
    return res.status(200).json({ ok: true });
  }

  const vorname = asText(body.Vorname).trim();
  const email = asText(body.email).trim();
  if (!vorname || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "Vorname oder E-Mail fehlt." });
  }

  // Every question is mandatory. The browser enforces this too (required
  // attributes + checkbox-group script); this catches no-JS and direct POSTs.
  const REQUIRED = [
    "F1_Anliegen",
    "F2_Stresslevel",
    "F3_Stress-Signale",
    "F4_Vorerfahrung",
    "F5_Passung",
    "F5_Bisher_probiert",
    "Einverstaendnis",
  ];
  const missing = REQUIRED.filter((key) => asText(body[key]).trim() === "");
  if (missing.length > 0) {
    return res.status(400).json({
      ok: false,
      error: "Bitte beantworte alle Fragen des Formulars.",
      missing,
    });
  }

  const isTest = asText(body._test).trim() !== "";

  const rows = FIELDS.map(([key, label]) => {
    const val = asText(body[key]).trim() || "—";
    return `<tr>
      <td style="padding:8px 14px 8px 0;vertical-align:top;color:#515762;white-space:nowrap"><strong>${escapeHtml(label)}</strong></td>
      <td style="padding:8px 0;vertical-align:top">${escapeHtml(val).replace(/\n/g, "<br/>")}</td>
    </tr>`;
  }).join("");

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.5">
    <h2 style="color:#515762">Neue Interessensbekundung${isTest ? " [TEST]" : ""}</h2>
    <p>Über die Landingpage <a href="https://selbstregulation.vercel.app">selbstregulation.vercel.app</a>:</p>
    <table style="border-collapse:collapse;max-width:680px">${rows}</table>
    <p style="margin-top:24px;color:#888;font-size:13px">Antworten gehen direkt an ${escapeHtml(vorname)} (${escapeHtml(email)}) — einfach auf diese E-Mail antworten.</p>
  </body></html>`;

  const payload = {
    from: FROM,
    to: isTest ? TEST_RECIPIENTS : RECIPIENTS,
    reply_to: email,
    subject: `${isTest ? "[TEST] " : ""}Neue Interessensbekundung: ${vorname}`,
    html,
  };

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    console.error("Resend error", resp.status, detail);
    return res.status(502).json({ ok: false, error: "Senden fehlgeschlagen." });
  }

  const data = await resp.json().catch(() => ({}));

  // No-JS fallback: a plain form POST lands here with an HTML Accept header.
  if ((req.headers.accept || "").includes("text/html")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(
      `<!doctype html><html lang="de"><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Danke!</title>
      <body style="font-family:Arial,Helvetica,sans-serif;display:grid;place-items:center;min-height:90vh;color:#515762;text-align:center;padding:24px">
      <div><h1>Danke, ${escapeHtml(vorname)}.</h1><p>Deine Interessensbekundung ist angekommen. Wir melden uns innerhalb einer Woche bei Dir.</p>
      <p><a href="/" style="color:#A4A859">Zurück zur Seite</a></p></div></body></html>`
    );
  }

  return res.status(200).json({ ok: true, id: data.id ?? null });
}
