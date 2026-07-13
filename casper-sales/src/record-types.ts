import type { RecordTypeDef } from "@casper/records";

/**
 * The Sales CRM record types (casper-sales plan §Scope) — Contact, Company, Deal —
 * expressed **purely as `RecordTypeDef` config** over the domain-agnostic records
 * engine. There is no engine code here and this module registers no tables: it
 * proves the engine/product split (success criterion: "zero engine code changes
 * required to ship this module"). Types are versioned (D-013); a schema change is a
 * `version` bump published through a change set, never an edit to engine code.
 *
 * Money is minor units + ISO currency (D-012): `amount` carries `{ amount, currency }`.
 * Ownership is the record's `owner_id` column (a reserved field), so "owner" is not a
 * data field on any type below.
 */

export const DEAL_STAGES = [
  { value: "new", label: "New" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
] as const;

const CONTACT_SOURCES = [
  { value: "referral", label: "Referral" },
  { value: "inbound", label: "Inbound" },
  { value: "outbound", label: "Outbound" },
  { value: "event", label: "Event" },
  { value: "other", label: "Other" },
];

export const contactType: RecordTypeDef = {
  key: "contact",
  name: { singular: "Contact", plural: "Contacts" },
  origin: "product",
  primaryField: "name",
  icon: "user",
  version: 1,
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "phone" },
    { key: "title", label: "Title", type: "text" },
    {
      key: "company",
      label: "Company",
      type: "relation",
      relation: { targetType: "company", cardinality: "one" },
    },
    { key: "source", label: "Source", type: "select", options: CONTACT_SOURCES },
    { key: "notes", label: "Notes", type: "long_text" },
  ],
};

export const companyType: RecordTypeDef = {
  key: "company",
  name: { singular: "Company", plural: "Companies" },
  origin: "product",
  primaryField: "name",
  icon: "building",
  version: 1,
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    // `unique` is stored now; enforcement is P2 (see records field-types.ts).
    { key: "domain", label: "Domain", type: "text", unique: true },
    {
      key: "industry",
      label: "Industry",
      type: "select",
      options: [
        { value: "saas", label: "SaaS" },
        { value: "agency", label: "Agency" },
        { value: "fintech", label: "Fintech" },
        { value: "ecommerce", label: "E-commerce" },
        { value: "manufacturing", label: "Manufacturing" },
        { value: "other", label: "Other" },
      ],
    },
    {
      key: "size",
      label: "Size",
      type: "select",
      options: [
        { value: "1-10", label: "1–10" },
        { value: "11-50", label: "11–50" },
        { value: "51-200", label: "51–200" },
        { value: "201-1000", label: "201–1000" },
        { value: "1000+", label: "1000+" },
      ],
    },
    { key: "region", label: "Region", type: "text" },
  ],
};

export const dealType: RecordTypeDef = {
  key: "deal",
  name: { singular: "Deal", plural: "Deals" },
  origin: "product",
  primaryField: "name",
  icon: "target",
  version: 1,
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    {
      key: "company",
      label: "Company",
      type: "relation",
      relation: { targetType: "company", cardinality: "one" },
    },
    {
      key: "contacts",
      label: "Contacts",
      type: "relation",
      relation: { targetType: "contact", cardinality: "many" },
    },
    {
      key: "primaryContact",
      label: "Primary contact",
      type: "relation",
      relation: { targetType: "contact", cardinality: "one", label: "primary contact" },
    },
    // Amount is `sensitive` (D-007/D-020): field edits are high-risk and capped for
    // assistants. Currency rides the money value (D-012), defaulting to SGD.
    {
      key: "amount",
      label: "Amount",
      type: "money",
      currency: "SGD",
      sensitivity: true,
    },
    {
      key: "stage",
      label: "Stage",
      type: "select",
      default: "new",
      options: [...DEAL_STAGES],
    },
    // Stamped by the workflow engine on every transition; drives stage-age SLA.
    { key: "stageEnteredAt", label: "Stage entered at", type: "datetime" },
    { key: "expectedCloseDate", label: "Expected close date", type: "date" },
    { key: "nextActionDate", label: "Next action date", type: "date" },
    {
      key: "source",
      label: "Source",
      type: "select",
      options: CONTACT_SOURCES,
    },
    { key: "lostReason", label: "Lost reason", type: "text" },
  ],
};

/** All product types this module contributes, in dependency order (company first). */
export const SALES_RECORD_TYPES: RecordTypeDef[] = [companyType, contactType, dealType];
