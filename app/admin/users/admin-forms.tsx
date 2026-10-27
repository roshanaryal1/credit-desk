"use client";

import { useActionState } from "react";

import type { UserRow } from "@/lib/identity/admin";

import {
  provisionUserAction,
  revokeSessionsAction,
  setActiveAction,
  updateAccessAction,
  type AdminState,
} from "./actions";

const ROLES = [
  "ANALYST",
  "CHECKER",
  "RISK_MANAGER",
  "AUDITOR",
  "ADMIN",
] as const;
const idle: AdminState = { status: "idle" };

function Status({ state }: { state: AdminState }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={
        state.status === "error"
          ? "text-destructive text-sm"
          : "text-muted-foreground text-sm"
      }
    >
      {state.message ?? ""}
    </p>
  );
}

function AccessFields({
  clients,
  roles = [],
  grants = [],
  idPrefix,
}: {
  clients: { id: string; name: string }[];
  roles?: readonly string[];
  grants?: readonly string[];
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Roles</legend>
        {ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="roles"
              value={role}
              defaultChecked={roles.includes(role)}
              id={`${idPrefix}-role-${role}`}
            />
            {role.replace("_", " ").toLowerCase()}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Client access</legend>
        {clients.map((client) => (
          <label key={client.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="clientIds"
              value={client.id}
              defaultChecked={grants.includes(client.id)}
            />
            {client.name}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

const button =
  "bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50";
const secondary =
  "focus-visible:ring-ring hover:bg-accent rounded-md border px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50";

export function ProvisionForm({
  clients,
}: {
  clients: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(provisionUserAction, idle);
  return (
    <form
      action={action}
      className="bg-card flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Work email
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            className="bg-background rounded-md border px-3 py-2 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Display name
          <input
            name="displayName"
            required
            minLength={2}
            maxLength={80}
            className="bg-background rounded-md border px-3 py-2 font-normal"
          />
        </label>
      </div>
      <AccessFields clients={clients} idPrefix="new" />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Saving..." : "Provision user"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function UserControls({
  user,
  clients,
  self,
}: {
  user: UserRow;
  clients: { id: string; name: string }[];
  self: boolean;
}) {
  const [accessState, accessAction, accessPending] = useActionState(
    updateAccessAction,
    idle,
  );
  const [activeState, activeAction, activePending] = useActionState(
    setActiveAction,
    idle,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeSessionsAction,
    idle,
  );
  return (
    <div className="flex flex-col gap-3">
      <form action={accessAction} className="flex flex-col gap-3">
        <input type="hidden" name="userId" value={user.id} />
        <AccessFields
          clients={clients}
          roles={user.roles}
          grants={user.clientIds}
          idPrefix={user.id}
        />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={accessPending} className={button}>
            Save access
          </button>
          <Status state={accessState} />
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <form action={activeAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input
            type="hidden"
            name="active"
            value={user.active ? "false" : "true"}
          />
          <button
            type="submit"
            disabled={activePending || self}
            className={secondary}
          >
            {user.active ? "Disable user" : "Enable user"}
          </button>
        </form>
        <form action={revokeAction}>
          <input type="hidden" name="userId" value={user.id} />
          <button
            type="submit"
            disabled={revokePending || user.liveSessions === 0}
            className={secondary}
          >
            Sign out everywhere
          </button>
        </form>
        <Status state={activeState.message ? activeState : revokeState} />
      </div>
    </div>
  );
}
