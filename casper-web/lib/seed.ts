import type { Company, Contact, Deal, Task, TimelineEvent, User } from "@/lib/types";

/* Demo dataset per casper-sales plan (D-017: dogfood runs on seed data, not import).
   Dates are anchored to the frozen demo clock 2026-07-12. */

export const USERS: User[] = [
  { id: "u_amara", name: "Amara Tan", initials: "AT", role: "member" },
  { id: "u_jun", name: "Jun Wei", initials: "JW", role: "manager" },
  { id: "u_priya", name: "Priya Nair", initials: "PN", role: "member" },
];

export const COMPANIES: Company[] = [
  { id: "c_acme", name: "Acme Pte Ltd", domain: "acme.sg", industry: "Manufacturing", size: "200–500", region: "Singapore" },
  { id: "c_meridian", name: "Meridian Group", domain: "meridian.com.sg", industry: "Professional services", size: "50–200", region: "Singapore" },
  { id: "c_northwind", name: "Northwind Logistics", domain: "northwind.asia", industry: "Logistics", size: "500+", region: "APAC" },
  { id: "c_helios", name: "Helios Energy", domain: "heliosenergy.io", industry: "Energy", size: "200–500", region: "Malaysia" },
  { id: "c_tanjong", name: "Tanjong Systems", domain: "tanjongsys.com", industry: "Software", size: "10–50", region: "Singapore" },
  { id: "c_brightline", name: "Brightline", domain: "brightline.co", industry: "Retail tech", size: "50–200", region: "Indonesia" },
  { id: "c_osaka", name: "Osaka Logistics", domain: "osakalog.jp", industry: "Logistics", size: "500+", region: "Japan" },
  { id: "c_vertex", name: "Vertex Analytics", domain: "vertex.ai", industry: "Data & AI", size: "50–200", region: "Singapore" },
  { id: "c_helix", name: "Helix Health", domain: "helixhealth.sg", industry: "Healthcare", size: "200–500", region: "Singapore" },
  { id: "c_crescent", name: "Crescent Retail", domain: "crescent.co.th", industry: "Retail", size: "500+", region: "Thailand" },
  { id: "c_kestrel", name: "Kestrel Labs", domain: "kestrel.dev", industry: "Software", size: "10–50", region: "Singapore" },
];

export const CONTACTS: Contact[] = [
  { id: "p_daniel", name: "Daniel Ng", title: "VP Operations", email: "daniel.ng@northwind.asia", companyId: "c_northwind" },
  { id: "p_sarah", name: "Sarah Lim", title: "Managing Partner", email: "sarah@meridian.com.sg", companyId: "c_meridian" },
  { id: "p_marcus", name: "Marcus Chen", title: "CFO", email: "m.chen@heliosenergy.io", companyId: "c_helios" },
  { id: "p_wei", name: "Wei Ling Koh", title: "Head of IT", email: "weiling@acme.sg", companyId: "c_acme" },
  { id: "p_arif", name: "Arif Rahman", title: "CTO", email: "arif@tanjongsys.com", companyId: "c_tanjong" },
  { id: "p_dewi", name: "Dewi Santoso", title: "COO", email: "dewi@brightline.co", companyId: "c_brightline" },
  { id: "p_kenji", name: "Kenji Watanabe", title: "GM Digital", email: "k.watanabe@osakalog.jp", companyId: "c_osaka" },
  { id: "p_grace", name: "Grace Teo", title: "Head of Data", email: "grace@vertex.ai", companyId: "c_vertex" },
  { id: "p_tan", name: "Dr. Tan Boon Kiat", title: "Director", email: "bk.tan@helixhealth.sg", companyId: "c_helix" },
  { id: "p_nok", name: "Nok Suwan", title: "IT Director", email: "nok.s@crescent.co.th", companyId: "c_crescent" },
  { id: "p_ivan", name: "Ivan Teh", title: "Founder", email: "ivan@kestrel.dev", companyId: "c_kestrel" },
];

export const DEALS: Deal[] = [
  {
    id: "d_acme", name: "Acme Cloud Migration", companyId: "c_acme", contactIds: ["p_wei"],
    stage: "negotiation", workflowVersion: 4, amount: 8_400_000, currency: "SGD",
    expectedCloseDate: "2026-07-31", nextActionDate: "2026-07-15", source: "Referral",
    ownerId: "u_amara", lostReason: null,
    lastActivityAt: "2026-07-09", stageEnteredAt: "2026-07-07",
  },
  {
    id: "d_northwind", name: "Northwind Renewal", companyId: "c_northwind", contactIds: ["p_daniel"],
    stage: "negotiation", workflowVersion: 4, amount: 12_800_000, currency: "SGD",
    expectedCloseDate: "2026-07-30", nextActionDate: "2026-06-28", source: "Existing customer",
    ownerId: "u_amara", lostReason: null,
    lastActivityAt: "2026-06-21", stageEnteredAt: "2026-06-30",
  },
  {
    id: "d_meridian", name: "Meridian Retainer", companyId: "c_meridian", contactIds: ["p_sarah"],
    stage: "proposal", workflowVersion: 4, amount: 3_600_000, currency: "SGD",
    expectedCloseDate: "2026-08-14", nextActionDate: "2026-07-05", source: "Outbound",
    ownerId: "u_amara", lostReason: null,
    lastActivityAt: "2026-07-06", stageEnteredAt: "2026-07-08",
  },
  {
    id: "d_helios", name: "Helios Expansion", companyId: "c_helios", contactIds: ["p_marcus"],
    stage: "proposal", workflowVersion: 4, amount: 5_900_000, currency: "SGD",
    expectedCloseDate: "2026-09-11", nextActionDate: null, source: "Event",
    ownerId: "u_amara", lostReason: null,
    lastActivityAt: "2026-06-26", stageEnteredAt: "2026-06-26",
  },
  {
    id: "d_tanjong", name: "Tanjong Systems Pilot", companyId: "c_tanjong", contactIds: ["p_arif"],
    stage: "new", workflowVersion: 4, amount: null, currency: "SGD",
    expectedCloseDate: null, nextActionDate: "2026-07-16", source: "Inbound",
    ownerId: "u_priya", lostReason: null,
    lastActivityAt: "2026-07-10", stageEnteredAt: "2026-07-10",
  },
  {
    id: "d_brightline", name: "Brightline CRM Replacement", companyId: "c_brightline", contactIds: ["p_dewi"],
    stage: "qualified", workflowVersion: 4, amount: 4_200_000, currency: "USD",
    expectedCloseDate: "2026-08-28", nextActionDate: "2026-07-17", source: "Outbound",
    ownerId: "u_jun", lostReason: null,
    lastActivityAt: "2026-07-08", stageEnteredAt: "2026-07-02",
  },
  {
    id: "d_osaka", name: "Osaka Logistics Portal", companyId: "c_osaka", contactIds: ["p_kenji"],
    stage: "new", workflowVersion: 4, amount: 1_800_000, currency: "USD",
    expectedCloseDate: null, nextActionDate: "2026-07-21", source: "Partner",
    ownerId: "u_priya", lostReason: null,
    lastActivityAt: "2026-07-11", stageEnteredAt: "2026-07-08",
  },
  {
    id: "d_vertex", name: "Vertex Analytics Suite", companyId: "c_vertex", contactIds: ["p_grace"],
    stage: "qualified", workflowVersion: 4, amount: 7_700_000, currency: "SGD",
    expectedCloseDate: "2026-08-20", nextActionDate: "2026-07-14", source: "Referral",
    ownerId: "u_amara", lostReason: null,
    lastActivityAt: "2026-07-10", stageEnteredAt: "2026-07-04",
  },
  {
    id: "d_kestrel", name: "Kestrel Onboarding", companyId: "c_kestrel", contactIds: ["p_ivan"],
    stage: "negotiation", workflowVersion: 4, amount: 2_300_000, currency: "SGD",
    expectedCloseDate: "2026-07-18", nextActionDate: "2026-07-14", source: "Inbound",
    ownerId: "u_jun", lostReason: null,
    lastActivityAt: "2026-07-11", stageEnteredAt: "2026-07-09",
  },
  {
    id: "d_helix", name: "Helix Annual", companyId: "c_helix", contactIds: ["p_tan"],
    stage: "won", workflowVersion: 3, amount: 5_200_000, currency: "SGD",
    expectedCloseDate: "2026-05-29", nextActionDate: null, source: "Existing customer",
    ownerId: "u_priya", lostReason: null,
    lastActivityAt: "2026-05-29", stageEnteredAt: "2026-05-29",
  },
  {
    id: "d_crescent", name: "Crescent Retail POS", companyId: "c_crescent", contactIds: ["p_nok"],
    stage: "lost", workflowVersion: 4, amount: 3_100_000, currency: "USD",
    expectedCloseDate: "2026-06-30", nextActionDate: null, source: "Outbound",
    ownerId: "u_jun", lostReason: "Chose incumbent vendor",
    lastActivityAt: "2026-06-17", stageEnteredAt: "2026-06-17",
  },
];

export const TASKS: Task[] = [
  { id: "t_1", title: "Send security questionnaire answers", dealId: "d_acme", assigneeId: "u_amara", dueDate: "2026-07-14", done: false, origin: "manual" },
  { id: "t_2", title: "Prep pricing options for Wei Ling", dealId: "d_acme", assigneeId: "u_amara", dueDate: "2026-07-15", done: false, origin: "manual" },
  { id: "t_3", title: "Confirm pilot scope with Arif", dealId: "d_tanjong", assigneeId: "u_priya", dueDate: "2026-07-16", done: false, origin: "manual" },
  { id: "t_4", title: "Intro call notes → CRM", dealId: "d_vertex", assigneeId: "u_amara", dueDate: "2026-07-10", done: true, origin: "manual" },
  { id: "t_5", title: "Onboarding kickoff — Helix Annual", dealId: "d_helix", assigneeId: "u_priya", dueDate: "2026-06-01", done: true, origin: "automation" },
];

let seedEventId = 0;
function ev(dealId: string, type: string, summary: string, actorName: string, source: TimelineEvent["source"], at: string): TimelineEvent {
  return { id: `se_${++seedEventId}`, dealId, type, summary, actorName, source, at };
}

export const TIMELINE: TimelineEvent[] = [
  ev("d_acme", "deal.created", "Deal created from referral", "Amara Tan", "ui", "2026-06-02"),
  ev("d_acme", "deal.stage_changed", "Qualified → Proposal", "Amara Tan", "ui", "2026-06-19"),
  ev("d_acme", "deal.stage_changed", "Proposal → Negotiation", "Amara Tan", "ui", "2026-07-07"),
  ev("d_acme", "note.added", "Legal wants SOC2 report before signature", "Amara Tan", "ui", "2026-07-09"),

  ev("d_northwind", "deal.created", "Renewal opportunity opened", "Amara Tan", "ui", "2026-05-12"),
  ev("d_northwind", "deal.stage_changed", "Proposal → Negotiation", "Amara Tan", "ui", "2026-06-30"),
  ev("d_northwind", "email.received", "Daniel: “circling back after our board meeting”", "Daniel Ng", "system", "2026-06-21"),
  ev("d_northwind", "record.neglected", "SLA scan: no activity 21d · next action overdue · 12d in Negotiation", "sla-scan", "system", "2026-07-12"),

  ev("d_meridian", "deal.created", "Outbound sequence reply", "Amara Tan", "ui", "2026-06-15"),
  ev("d_meridian", "deal.stage_changed", "Qualified → Proposal", "Amara Tan", "ui", "2026-07-08"),
  ev("d_meridian", "note.added", "Sarah asked for revised scope — sent v2 proposal", "Amara Tan", "ui", "2026-07-06"),
  ev("d_meridian", "record.neglected", "SLA scan: next action overdue since 05 Jul", "sla-scan", "system", "2026-07-12"),

  ev("d_helios", "deal.created", "Met Marcus at Energy Asia 2026", "Amara Tan", "ui", "2026-06-10"),
  ev("d_helios", "deal.stage_changed", "Qualified → Proposal", "Amara Tan", "ui", "2026-06-26"),
  ev("d_helios", "record.neglected", "SLA scan: no activity 16d · 16d in Proposal", "sla-scan", "system", "2026-07-12"),

  ev("d_tanjong", "deal.created", "Inbound demo request", "Priya Nair", "ui", "2026-07-10"),
  ev("d_brightline", "deal.created", "Outbound — replied to Dewi", "Jun Wei", "ui", "2026-06-24"),
  ev("d_brightline", "deal.stage_changed", "New → Qualified", "Jun Wei", "ui", "2026-07-02"),
  ev("d_osaka", "deal.created", "Partner referral from JTC", "Priya Nair", "ui", "2026-07-08"),
  ev("d_vertex", "deal.created", "Referral from Helix Health", "Amara Tan", "ui", "2026-06-28"),
  ev("d_vertex", "deal.stage_changed", "New → Qualified", "Amara Tan", "ui", "2026-07-04"),
  ev("d_kestrel", "deal.created", "Inbound from pricing page", "Jun Wei", "ui", "2026-07-01"),
  ev("d_kestrel", "deal.stage_changed", "Proposal → Negotiation", "Jun Wei", "ui", "2026-07-09"),

  ev("d_helix", "deal.stage_changed", "Negotiation → Won", "Priya Nair", "ui", "2026-05-29"),
  ev("d_helix", "automation.executed", "Won → onboarding kickoff task created", "workflow", "automation", "2026-05-29"),
  ev("d_crescent", "deal.stage_changed", "Negotiation → Lost (chose incumbent vendor)", "Jun Wei", "ui", "2026-06-17"),
  ev("d_crescent", "automation.executed", "Lost → owner’s manager notified", "workflow", "automation", "2026-06-17"),
];
