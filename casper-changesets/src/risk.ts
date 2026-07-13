import type { ChangeOp, ChangeTarget, Risk } from "./types.js";

/**
 * Risk is computed from op × target (D-007), never declared by the caller — "an
 * assistant cannot label its own work low-risk." P1b mapping:
 *   high   = config_publish (workflow publishes), delete (irreversible)
 *   medium = create, update (ordinary fields), transition (normal stage moves)
 * Field-sensitivity → high (D-020) is a fast-follow once field-level payloads carry
 * sensitivity metadata here.
 */
export function computeRisk(op: ChangeOp, _target: ChangeTarget, _payload: unknown): Risk {
  switch (op) {
    case "config_publish":
    case "delete":
      return "high";
    case "create":
    case "update":
    case "transition":
      return "medium";
  }
}
