import {
  requireAccess,
  type IdentityContext,
} from "@/lib/security/access";

/**
 * CLOSED-LOOP SIMULATION ONLY.
 * No bank client, payment API, funding ledger mutation or real-world authority.
 */
export interface SyntheticAvailability {
  sourceId: string;
  asOfDate: string;
  availableCents: number;
  simulationOnly: true;
}

export interface SimulatedDraw {
  id: string;
  clientId: string;
  invoiceId: string;
  requestedCents: number;
  availabilitySourceId: string;
  asOfDate: string;
  makerId: string;
  checkerId: string | null;
  state: "PENDING_CHECK" | "APPROVED_SIMULATION" | "REJECTED" | "SIMULATED_SETTLED";
  version: number;
  reason: string | null;
}

export interface DrawEvent {
  intentId: string;
  actorId: string;
  action: "PROPOSE" | "APPROVE" | "REJECT" | "SIMULATE_SETTLEMENT";
  previousState: SimulatedDraw["state"] | null;
  newState: SimulatedDraw["state"];
  version: number;
  occurredAt: string;
  reason: string | null;
}

function validCents(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("A positive safe integer NZD amount is required");
}

function time(value: string): number {
  const date = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !value.endsWith("Z") ||
      !Number.isFinite(date))
    throw new Error("UTC event instant required");
  return date;
}

export function proposeSimulation(
  args: {
    id: string; clientId: string; invoiceId: string;
    requestedCents: number; availability: SyntheticAvailability;
  },
  actor: IdentityContext,
  occurredAt: string,
): { intent: SimulatedDraw; event: DrawEvent } {
  const at = time(occurredAt);
  if (!args.id.trim() || !args.clientId.trim() || !args.invoiceId.trim())
    throw new Error("Intent, client and invoice IDs are required");
  requireAccess(actor,{tenantId:actor.tenantId,clientId:args.clientId},"CASE_PROPOSE",at);
  validCents(args.requestedCents);
  if (args.availability.simulationOnly !== true || !args.availability.sourceId.trim())
    throw new Error("Only sourced synthetic availability is supported");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.availability.asOfDate))
    throw new Error("Business date required");
  if (!Number.isSafeInteger(args.availability.availableCents) ||
      args.availability.availableCents < args.requestedCents)
    throw new Error("Insufficient simulated availability");
  const intent: SimulatedDraw = {
    id:args.id,clientId:args.clientId,invoiceId:args.invoiceId,
    requestedCents:args.requestedCents,availabilitySourceId:args.availability.sourceId,
    asOfDate:args.availability.asOfDate,makerId:actor.subject,checkerId:null,
    state:"PENDING_CHECK",version:1,reason:null,
  };
  return {intent,event:{
    intentId:intent.id,actorId:actor.subject,action:"PROPOSE",
    previousState:null,newState:intent.state,version:1,occurredAt,reason:null,
  }};
}

/** Caller must persist the event and state atomically with CAS on version. */
export function transitionSimulation(
  old: SimulatedDraw,
  operation: {kind:"APPROVE" | "REJECT" | "SIMULATE_SETTLEMENT"; reason:string},
  actor: IdentityContext,
  expectedVersion: number,
  occurredAt: string,
): {intent:SimulatedDraw;event:DrawEvent} {
  const at=time(occurredAt);
  requireAccess(actor,{tenantId:actor.tenantId,clientId:old.clientId},"CASE_CHECK",at);
  if (old.version !== expectedVersion) throw new Error("Stale funding intent");
  if (actor.subject === old.makerId) throw new Error("Maker cannot check their own draw");
  if (!operation.reason.trim() || operation.reason.trim().length < 8)
    throw new Error("Substantive reviewer reason required");
  if (operation.kind === "SIMULATE_SETTLEMENT") {
    if (old.state !== "APPROVED_SIMULATION" || old.checkerId !== actor.subject)
      throw new Error("Only the approving checker can simulate settlement");
  } else if (old.state !== "PENDING_CHECK") {
    throw new Error("Intent is not awaiting review");
  }
  const next: SimulatedDraw = {
    ...old,checkerId:actor.subject,version:old.version+1,
    reason:operation.reason.trim(),
    state:operation.kind === "APPROVE" ? "APPROVED_SIMULATION" :
      operation.kind === "REJECT" ? "REJECTED" : "SIMULATED_SETTLED",
  };
  return {intent:next,event:{
    intentId:old.id,actorId:actor.subject,action:operation.kind,
    previousState:old.state,newState:next.state,version:next.version,
    occurredAt,reason:next.reason,
  }};
}
