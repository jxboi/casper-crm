import type { RecordTypeDef } from "./field-types.js";
import { defineRecordType } from "./registry.js";

/**
 * System record types (D-013) — defined in code, `origin: 'system'`. Task, Note,
 * and Attachment are engine-provided; product types (Contact, Company, Deal) are
 * seeded by casper-sales as versioned config. `relatedTo` is a generic RecordRef
 * ({ type, id }) stored as JSON so a task/note/attachment can attach to anything.
 */
export const taskType: RecordTypeDef = {
  key: "task",
  name: { singular: "Task", plural: "Tasks" },
  origin: "system",
  primaryField: "title",
  version: 1,
  fields: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "assignee", label: "Assignee", type: "user" },
    { key: "due", label: "Due", type: "date" },
    {
      key: "status",
      label: "Status",
      type: "select",
      default: "open",
      options: [
        { value: "open", label: "Open" },
        { value: "in_progress", label: "In progress" },
        { value: "done", label: "Done" },
      ],
    },
    {
      key: "priority",
      label: "Priority",
      type: "select",
      default: "medium",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    },
    { key: "relatedTo", label: "Related to", type: "json" },
    {
      key: "source",
      label: "Source",
      type: "select",
      default: "manual",
      options: [
        { value: "manual", label: "Manual" },
        { value: "automation", label: "Automation" },
        { value: "ai", label: "AI" },
      ],
    },
  ],
};

export const noteType: RecordTypeDef = {
  key: "note",
  name: { singular: "Note", plural: "Notes" },
  origin: "system",
  primaryField: "body",
  version: 1,
  fields: [
    { key: "body", label: "Body", type: "long_text", required: true },
    { key: "relatedTo", label: "Related to", type: "json" },
  ],
};

export const attachmentType: RecordTypeDef = {
  key: "attachment",
  name: { singular: "Attachment", plural: "Attachments" },
  origin: "system",
  primaryField: "filename",
  version: 1,
  fields: [
    { key: "filename", label: "Filename", type: "text", required: true },
    { key: "blobRef", label: "Blob ref", type: "text", required: true },
    { key: "contentType", label: "Content type", type: "text" },
    { key: "relatedTo", label: "Related to", type: "json" },
  ],
};

export const SYSTEM_TYPES: RecordTypeDef[] = [taskType, noteType, attachmentType];

export function registerSystemTypes(): void {
  for (const t of SYSTEM_TYPES) defineRecordType(t);
}
