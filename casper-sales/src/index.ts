// casper-sales — the first product: a Sales CRM, expressed as **configuration only**
// (record types, pipeline, automations, views, terminology, seed data) over the
// domain-agnostic engine (records, workflow, events). This module registers no tables
// and changes no engine code — it is the proof of the engine/product split (plan
// §Purpose) that makes a second product a copy of this module's shape, not a fork.

import { defineRecordType } from "@casper/records";
import { defineWorkflow, defineAutomation } from "@casper/workflow";
import { SALES_RECORD_TYPES } from "./record-types.js";
import { dealPipeline } from "./pipeline.js";
import { SALES_AUTOMATIONS } from "./automations.js";

/**
 * Register the sales product config into the in-memory registries (record types,
 * the pipeline workflow, the default automations). Call once at app/test bootstrap,
 * after the engine modules are registered and before `runMigrations`. Idempotent —
 * re-registration replaces by key (D-013). Unlike the engine modules there is no
 * `registerMigrations` call: this module owns no schema.
 */
export function registerSalesModule(): void {
  for (const type of SALES_RECORD_TYPES) defineRecordType(type);
  defineWorkflow(dealPipeline);
  for (const automation of SALES_AUTOMATIONS) defineAutomation(automation);
}

// Record types (config-as-data)
export {
  SALES_RECORD_TYPES,
  companyType,
  contactType,
  dealType,
  DEAL_STAGES,
} from "./record-types.js";

// Pipeline workflow + neglect SLA
export { dealPipeline } from "./pipeline.js";

// Automations
export {
  SALES_AUTOMATIONS,
  onboardingOnWon,
  notifyManagerOnLost,
} from "./automations.js";

// Default views
export {
  seedDefaultViews,
  OPEN_DEAL_STAGES,
  NEGLECTED_DEALS_FILTER,
  type SeededViews,
} from "./views.js";

// Terminology
export { salesTerminology, salesTerm, type Terminology } from "./terminology.js";

// Seed runner (dogfood data source, D-017)
export { seedSalesData, type SeedVariant, type SeedResult } from "./seed.js";
