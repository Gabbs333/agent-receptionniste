import { Router, type Request, type Response } from "express";
import { prisma } from "../db";
import { getAllAvailability, setAvailability, deleteAvailability } from "../availability";

const router = Router();

// --- Auth middleware ---
function requireAuth(req: Request, res: Response, next: Function) {
  const key = req.headers["x-api-key"] ?? req.query["key"];
  if (process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}

// ==================== JSON API Endpoints ====================

/** GET /admin/leads — JSON list of leads */
router.get("/leads", requireAuth, async (req, res) => {
  try {
    const { status, minScore, search } = req.query as Record<string, string | undefined>;
    const limit = String(req.query.limit ?? "50");
    const offset = String(req.query.offset ?? "0");
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (minScore) where.score = { gte: Number(minScore) };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ];
    }
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: Math.min(Number(limit), 200),
        skip: Number(offset),
        include: { _count: { select: { messages: true, offers: true } } },
      }),
      prisma.lead.count({ where }),
    ]);
    return res.json({ leads, total });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** GET /admin/leads/:id — single lead detail */
router.get("/leads/:id", requireAuth, async (req, res) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: String(req.params.id) },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        offers: { orderBy: { createdAt: "desc" } },
        events: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!lead) return res.status(404).json({ error: "Not found" });
    return res.json(lead);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** PATCH /admin/leads/:id — update lead status/notes */
router.patch("/leads/:id", requireAuth, async (req, res) => {
  try {
    const { status, name, notes } = req.body;
    const lead = await prisma.lead.update({
      where: { id: String(req.params.id) },
      data: {
        ...(status ? { status } : {}),
        ...(name ? { name } : {}),
      },
    });
    return res.json(lead);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** GET /admin/room-types */
router.get("/room-types", requireAuth, async (_req, res) => {
  const types = await prisma.roomType.findMany({ orderBy: { name: "asc" } });
  return res.json(types);
});

/** POST /admin/room-types */
router.post("/room-types", requireAuth, async (req, res) => {
  try {
    const { name, capacity, basePrice, description } = req.body;
    if (!name || !capacity || !basePrice) {
      return res.status(400).json({ error: "name, capacity, basePrice required" });
    }
    const rt = await prisma.roomType.create({
      data: { name, capacity: Number(capacity), basePrice: Number(basePrice), description },
    });
    return res.status(201).json(rt);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** GET /admin/availability — JSON list */
router.get("/availability", requireAuth, async (_req, res) => {
  const data = await getAllAvailability();
  return res.json(data);
});

/** POST /admin/availability — upsert */
router.post("/availability", requireAuth, async (req, res) => {
  try {
    const { roomTypeId, date, available, price, currency, minNights, status, notes } = req.body;
    if (!roomTypeId || !date || available == null || price == null) {
      return res.status(400).json({ error: "roomTypeId, date, available, price required" });
    }
    const result = await setAvailability({
      roomTypeId,
      date: new Date(date),
      available: Number(available),
      price: Number(price),
      currency,
      minNights: minNights ? Number(minNights) : undefined,
      status,
      notes,
    });
    return res.status(201).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** DELETE /admin/availability/:id */
router.delete("/availability/:id", requireAuth, async (req, res) => {
  try {
    await deleteAvailability(String(req.params.id));
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/** GET /admin/stats — dashboard stats */
router.get("/stats", requireAuth, async (_req, res) => {
  try {
    const [total, hot, warm, cold, newLeads, todayMessages] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { status: "hot" } }),
      prisma.lead.count({ where: { status: "warm" } }),
      prisma.lead.count({ where: { status: "cold" } }),
      prisma.lead.count({ where: { status: "new" } }),
      prisma.message.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      }),
    ]);
    return res.json({ total, hot, warm, cold, new: newLeads, todayMessages });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

// ==================== HTML Dashboard Pages ====================

const HTML_HEADER = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HotelBot - Administration</title>
<style>
  :root { --bg: #f8fafc; --card: #fff; --text: #1e293b; --muted: #64748b; --border: #e2e8f0; --accent: #2563eb; --hot: #ef4444; --warm: #f59e0b; --cold: #6b7280; --new: #3b82f6; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  .container { max-width: 1280px; margin: 0 auto; padding: 16px; }
  header { background: var(--card); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 1.25rem; }
  nav { display: flex; gap: 8px; }
  nav a { text-decoration: none; padding: 6px 14px; border-radius: 6px; font-size: .875rem; color: var(--muted); }
  nav a.active { background: var(--accent); color: #fff; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px,1fr)); gap: 12px; margin: 20px 0; }
  .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .stat-card .label { font-size: .75rem; color: var(--muted); text-transform: uppercase; }
  .stat-card .value { font-size: 1.5rem; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  th, td { padding: 10px 14px; text-align: left; font-size: .875rem; }
  th { background: #f1f5f9; font-weight: 600; }
  tr:not(:last-child) td { border-bottom: 1px solid var(--border); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .75rem; font-weight: 600; color: #fff; }
  .badge-hot { background: var(--hot); }
  .badge-warm { background: var(--warm); }
  .badge-cold { background: var(--cold); }
  .badge-new { background: var(--new); }
  .badge-needs_human { background: #8b5cf6; }
  .score-bar { width: 60px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 6px; }
  .score-bar-fill { height: 100%; border-radius: 3px; }
  .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .filter-bar select, .filter-bar input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: .875rem; }
  .btn { display: inline-block; padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: .875rem; font-weight: 500; text-decoration: none; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-danger { background: var(--hot); color: #fff; }
  .btn-sm { padding: 4px 10px; font-size: .75rem; }
  .form-group { margin-bottom: 12px; }
  .form-group label { display: block; font-size: .875rem; font-weight: 500; margin-bottom: 4px; }
  .form-group input, .form-group select { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: .875rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  .flex { display: flex; gap: 16px; flex-wrap: wrap; }
  .flex > * { flex: 1; min-width: 280px; }
  .toast { position: fixed; top: 16px; right: 16px; padding: 10px 20px; border-radius: 8px; color: #fff; font-size: .875rem; z-index: 999; display: none; }
  .toast.success { background: #16a34a; }
  .toast.error { background: var(--hot); }
</style>
</head>
<body>
<header>
  <h1>🏨 HotelBot Admin</h1>
  <nav>
    <a href="/admin/dashboard" class="active">📊 Dashboard</a>
    <a href="/admin/availability-page">📅 Disponibilités</a>
  </nav>
</header>
<div class="container">
<div id="toast" class="toast"></div>`;

const HTML_FOOTER = `</div></body></html>`;

/** GET /admin/dashboard — HTML dashboard */
router.get("/dashboard", requireAuth, async (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.write(HTML_HEADER);

  // Fetch initial data
  const [leads, stats] = await Promise.all([
    prisma.lead.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { _count: { select: { messages: true } } },
    }),
    (async () => {
      const [total, hot, warm, cold, newLeads, today] = await Promise.all([
        prisma.lead.count(),
        prisma.lead.count({ where: { status: "hot" } }),
        prisma.lead.count({ where: { status: "warm" } }),
        prisma.lead.count({ where: { status: "cold" } }),
        prisma.lead.count({ where: { status: "new" } }),
        prisma.message.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
      ]);
      return { total, hot, warm, cold, new: newLeads, todayMessages: today };
    })(),
  ]);

  const statusLabel: Record<string, string> = {
    hot: "🔥 Chaud", warm: "🌤 Tiède", cold: "❄ Froid",
    new: "🆕 Nouveau", needs_human: "👤 Humain requis", converted: "✅ Converti",
  };

  res.write(`
    <div class="stats">
      <div class="stat-card"><div class="label">Total Leads</div><div class="value">${stats.total}</div></div>
      <div class="stat-card"><div class="label">🔥 Chauds</div><div class="value" style="color:var(--hot)">${stats.hot}</div></div>
      <div class="stat-card"><div class="label">🌤 Tièdes</div><div class="value" style="color:var(--warm)">${stats.warm}</div></div>
      <div class="stat-card"><div class="label">❄ Froids</div><div class="value" style="color:var(--cold)">${stats.cold}</div></div>
      <div class="stat-card"><div class="label">🆕 Nouveaux</div><div class="value" style="color:var(--new)">${stats.new}</div></div>
      <div class="stat-card"><div class="label">💬 Msg / 24h</div><div class="value">${stats.todayMessages}</div></div>
    </div>

    <div class="filter-bar">
      <input type="text" id="searchInput" placeholder="🔍 Rechercher nom/tel..." oninput="filterTable()">
      <select id="statusFilter" onchange="filterTable()">
        <option value="">Tous les statuts</option>
        <option value="hot">🔥 Chaud</option>
        <option value="warm">🌤 Tiède</option>
        <option value="cold">❄ Froid</option>
        <option value="new">🆕 Nouveau</option>
        <option value="needs_human">👤 Humain requis</option>
        <option value="converted">✅ Converti</option>
      </select>
      <select id="scoreFilter" onchange="filterTable()">
        <option value="">Tous les scores</option>
        <option value="80">Score ≥ 80</option>
        <option value="50">Score ≥ 50</option>
        <option value="30">Score ≥ 30</option>
      </select>
    </div>

    <table>
      <thead>
        <tr>
          <th>Nom</th><th>Téléphone</th><th>Statut</th><th>Score</th>
          <th>Intention</th><th>Budget</th><th>Messages</th><th>Dernière activité</th><th></th>
        </tr>
      </thead>
      <tbody id="leadsTableBody">
  `);

  for (const l of leads) {
    const badgeClass = l.status === "hot" ? "badge-hot" : l.status === "warm" ? "badge-warm" : l.status === "cold" ? "badge-cold" : l.status === "new" ? "badge-new" : "badge-needs_human";
    const scoreColor = l.score >= 80 ? "var(--hot)" : l.score >= 50 ? "var(--warm)" : "var(--cold)";
    const scoreWidth = Math.min(100, l.score);
    res.write(`
      <tr data-status="${l.status}" data-score="${l.score}" data-search="${l.name ?? ""} ${l.phone}">
        <td><strong>${l.name ?? "—"}</strong></td>
        <td>${l.phone}</td>
        <td><span class="badge ${badgeClass}">${statusLabel[l.status] ?? l.status}</span></td>
        <td><span class="score-bar"><span class="score-bar-fill" style="width:${scoreWidth}%;background:${scoreColor}"></span></span>${l.score}</td>
        <td>${l.intent ?? "—"}</td>
        <td>${l.budget ? l.budget.toLocaleString("fr-FR") + " XAF" : "—"}</td>
        <td>${l._count.messages}</td>
        <td>${l.updatedAt.toLocaleDateString("fr-FR")}</td>
        <td><a href="/admin/lead-detail/${l.id}" class="btn btn-sm btn-primary">Voir</a></td>
      </tr>`);
  }

  res.write(`</tbody></table>
    <script>
      function filterTable() {
        const search = document.getElementById('searchInput').value.toLowerCase();
        const status = document.getElementById('statusFilter').value;
        const minScore = parseInt(document.getElementById('scoreFilter').value) || 0;
        document.querySelectorAll('#leadsTableBody tr').forEach(tr => {
          const matchSearch = !search || tr.dataset.search.toLowerCase().includes(search);
          const matchStatus = !status || tr.dataset.status === status;
          const matchScore = parseInt(tr.dataset.score) >= minScore;
          tr.style.display = matchSearch && matchStatus && matchScore ? '' : 'none';
        });
      }
    </script>
  `);
  res.write(HTML_FOOTER);
  res.end();
});

/** GET /admin/lead-detail/:id */
router.get("/lead-detail/:id", requireAuth, async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: String(req.params.id) },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      offers: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) return res.status(404).send("Lead not found");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leadWithIncludes = lead as any;

  const stats = {
    responseDelay: leadWithIncludes.messages.length >= 2
      ? Math.round((leadWithIncludes.messages[1].createdAt.getTime() - leadWithIncludes.messages[0].createdAt.getTime()) / 60000)
      : null,
    totalMessages: leadWithIncludes.messages.length,
    totalOffers: leadWithIncludes.offers.length,
    conversionRate: lead.status === "converted" ? "✅ Converti" : "En cours",
  };

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Lead ${lead.name ?? lead.phone}</title>
<style>
  :root { --bg: #f8fafc; --card: #fff; --text: #1e293b; --muted: #64748b; --border: #e2e8f0; --accent: #2563eb; }
  body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
  .container { max-width: 960px; margin: 0 auto; }
  .back { color: var(--accent); text-decoration: none; font-size: .875rem; }
  h1 { font-size: 1.5rem; margin: 12px 0; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap: 12px; }
  .label { font-size: .75rem; color: var(--muted); text-transform: uppercase; }
  .value { font-weight: 600; }
  .conversation { max-height: 500px; overflow-y: auto; }
  .msg { padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; max-width: 80%; }
  .msg.inbound { background: #e0f2fe; margin-right: auto; }
  .msg.outbound { background: #dcfce7; margin-left: auto; text-align: right; }
  .msg-meta { font-size: .7rem; color: var(--muted); }
  pre { background: #f1f5f9; padding: 8px; border-radius: 6px; font-size: .8rem; overflow-x: auto; }
</style></head><body><div class="container">
<a href="/admin/dashboard" class="back">← Retour au dashboard</a>
<h1>👤 ${lead.name ?? "Inconnu"} <span style="font-size:.875rem;color:var(--muted)">${lead.phone}</span></h1>

<div class="grid" style="margin-bottom:16px">
  <div class="card"><div class="label">Score</div><div class="value" style="font-size:1.5rem">${lead.score}</div></div>
  <div class="card"><div class="label">Statut</div><div class="value">${lead.status}</div></div>
  <div class="card"><div class="label">Intention</div><div class="value">${lead.intent ?? "—"}</div></div>
  <div class="card"><div class="label">Budget</div><div class="value">${lead.budget ? lead.budget.toLocaleString("fr-FR") + " XAF" : "—"}</div></div>
  <div class="card"><div class="label">Personnes</div><div class="value">${lead.guests ?? "—"}</div></div>
  <div class="card"><div class="label">Type chambre</div><div class="value">${lead.roomType ?? "—"}</div></div>
  <div class="card"><div class="label">Check-in</div><div class="value">${lead.checkIn?.toLocaleDateString("fr-FR") ?? "—"}</div></div>
  <div class="card"><div class="label">Check-out</div><div class="value">${lead.checkOut?.toLocaleDateString("fr-FR") ?? "—"}</div></div>
  <div class="card"><div class="label">Langue</div><div class="value">${lead.language}</div></div>
  <div class="card"><div class="label">Source</div><div class="value">${lead.source ?? "—"}</div></div>
</div>

<div class="card">
  <h3>💬 Conversation (${leadWithIncludes.messages.length} messages)</h3>
  <div class="conversation">
    ${leadWithIncludes.messages.map((m: any) => `
      <div class="msg ${m.direction}">
        <div>${m.content}</div>
        <div class="msg-meta">${m.direction} · ${m.createdAt.toLocaleString("fr-FR")}</div>
      </div>`).join("")}
  </div>
</div>

<div class="card">
  <h3>🏷 Offres générées</h3>
  ${leadWithIncludes.offers.length === 0 ? "<p>Aucune offre</p>" : leadWithIncludes.offers.map((o: any) => `<div style="margin-bottom:8px"><strong>${o.roomType}</strong> — ${o.price.toLocaleString("fr-FR")} ${o.currency}${o.notes ? `<br><small>${o.notes}</small>` : ""}</div>`).join("")}
</div>

<div class="card">
  <h3>📋 Événements</h3>
  ${leadWithIncludes.events.length === 0 ? "<p>Aucun événement</p>" : leadWithIncludes.events.map((e: any) => `<div style="margin-bottom:8px"><strong>${e.type}</strong> · ${e.createdAt.toLocaleString("fr-FR")}<br><pre>${e.payload}</pre></div>`).join("")}
</div>

</div></body></html>`);
  res.end();
});

/** GET /admin/availability-page — HTML form to manage availability */
router.get("/availability-page", requireAuth, async (_req, res) => {
  const [availabilities, roomTypes] = await Promise.all([
    getAllAvailability(),
    prisma.roomType.findMany({ orderBy: { name: "asc" } }),
  ]);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Disponibilités</title>
<style>
  :root { --bg: #f8fafc; --card: #fff; --text: #1e293b; --muted: #64748b; --border: #e2e8f0; --accent: #2563eb; --danger: #ef4444; }
  body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
  .container { max-width: 1200px; margin: 0 auto; }
  nav { margin-bottom: 20px; }
  nav a { color: var(--accent); text-decoration: none; margin-right: 16px; font-size: .875rem; }
  h1 { font-size: 1.25rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 14px; text-align: left; font-size: .875rem; border-bottom: 1px solid var(--border); }
  th { background: #f1f5f9; font-weight: 600; }
  .form-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 4px; }
  .form-group label { font-size: .75rem; font-weight: 600; color: var(--muted); }
  .form-group input, .form-group select { padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: .875rem; min-width: 120px; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: .875rem; font-weight: 500; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-danger { background: var(--danger); color: #fff; }
  .btn-sm { padding: 4px 10px; font-size: .75rem; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .75rem; font-weight: 600; }
  .badge-open { background: #16a34a; color: #fff; }
  .badge-closed { background: var(--muted); color: #fff; }
  .toast { position: fixed; top: 16px; right: 16px; padding: 10px 20px; border-radius: 8px; color: #fff; font-size: .875rem; z-index: 999; display: none; }
  .toast.success { background: #16a34a; }
  .toast.error { background: var(--danger); }
</style></head><body><div class="container">
<nav><a href="/admin/dashboard">← Dashboard</a></nav>
<h1>📅 Gestion des disponibilités</h1>

<div class="card">
  <h3 style="margin-bottom:12px">➕ Ajouter / Modifier une disponibilité</h3>
  <div class="form-row">
    <div class="form-group">
      <label>Type de chambre</label>
      <select id="roomTypeId">${roomTypes.map(rt => `<option value="${rt.id}">${rt.name} (max ${rt.capacity} pers.)</option>`).join("")}</select>
    </div>
    <div class="form-group">
      <label>Date</label>
      <input type="date" id="availDate">
    </div>
    <div class="form-group">
      <label>Chambres dispo.</label>
      <input type="number" id="availCount" value="1" min="0" style="width:80px">
    </div>
    <div class="form-group">
      <label>Prix (XAF)</label>
      <input type="number" id="availPrice" value="30000" min="0" style="width:130px">
    </div>
    <div class="form-group">
      <label>Nuits min.</label>
      <input type="number" id="availMinNights" value="1" min="1" style="width:70px">
    </div>
    <div class="form-group">
      <label>Statut</label>
      <select id="availStatus"><option value="open">Ouvert</option><option value="closed">Fermé</option></select>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <input type="text" id="availNotes" placeholder="Optionnel">
    </div>
    <button class="btn btn-primary" onclick="saveAvailability()">💾 Enregistrer</button>
  </div>
</div>

<div class="card">
  <h3 style="margin-bottom:12px">📋 Disponibilités actuelles <span style="font-weight:400;font-size:.875rem;color:var(--muted)">(${availabilities.length} entrées)</span></h3>
  ${availabilities.length === 0 ? "<p>Aucune disponibilité enregistrée.</p>" : `
  <table>
    <thead><tr><th>Type</th><th>Date</th><th>Dispo</th><th>Prix</th><th>Min Nuits</th><th>Statut</th><th>Notes</th><th></th></tr></thead>
    <tbody>
      ${availabilities.map(a => `
        <tr id="row-${a.id}">
          <td>${a.roomType.name}</td>
          <td>${a.date.toISOString().split("T")[0]}</td>
          <td>${a.available}</td>
          <td>${a.price.toLocaleString("fr-FR")} ${a.currency}</td>
          <td>${a.minNights}</td>
          <td><span class="badge badge-${a.status}">${a.status}</span></td>
          <td>${a.notes ?? "—"}</td>
          <td><button class="btn btn-danger btn-sm" onclick="deleteAvailability('${a.id}')">🗑</button></td>
        </tr>`).join("")}
    </tbody>
  </table>`}
</div>

<div id="toast" class="toast"></div>
<script>
  function showToast(msg, type) { const t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast ' + type; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 3000); }
  async function saveAvailability() {
    const data = {
      roomTypeId: document.getElementById('roomTypeId').value,
      date: document.getElementById('availDate').value,
      available: parseInt(document.getElementById('availCount').value),
      price: parseInt(document.getElementById('availPrice').value),
      minNights: parseInt(document.getElementById('availMinNights').value),
      status: document.getElementById('availStatus').value,
      notes: document.getElementById('availNotes').value || undefined,
    };
    if (!data.date) return showToast("Veuillez choisir une date", "error");
    try {
      const res = await fetch('/admin/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': '${process.env.ADMIN_API_KEY}' },
        body: JSON.stringify(data),
      });
      if (res.ok) { showToast("Disponibilité enregistrée ✓", "success"); setTimeout(() => location.reload(), 800); }
      else showToast("Erreur lors de l'enregistrement", "error");
    } catch(e) { showToast("Erreur réseau", "error"); }
  }
  async function deleteAvailability(id) {
    if (!confirm("Supprimer cette disponibilité ?")) return;
    try {
      const res = await fetch('/admin/availability/' + id, { method: 'DELETE', headers: { 'x-api-key': '${process.env.ADMIN_API_KEY}' } });
      if (res.ok) { document.getElementById('row-' + id).remove(); showToast("Supprimé ✓", "success"); }
      else showToast("Erreur suppression", "error");
    } catch(e) { showToast("Erreur réseau", "error"); }
  }
</script>
</div></body></html>`);
  res.end();
});

export default router;
