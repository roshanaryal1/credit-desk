import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Loading, PageHeader, Section } from "@/components/page";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { listUsers } from "@/lib/identity/admin";
import { currentAdministrator } from "@/lib/identity/current";

import { ProvisionForm, UserControls } from "./admin-forms";

export const metadata = { title: "Users and access" };

export default function AdminUsersPage() {
  return (
    <>
      <PageHeader
        title="Users and access"
        description="Provision users, assign roles and client access, and revoke sessions. Every change is recorded in the audit log."
      />
      <Suspense fallback={<Loading label="Loading users" />}>
        <Users />
      </Suspense>
    </>
  );
}

async function Users() {
  const session = await currentAdministrator();
  if (!session) notFound();
  const db = await getDb();
  const [users, clients] = await Promise.all([
    listUsers(db, session.identity.tenantId, new Date()),
    db
      .select({ id: t.clients.id, name: t.clients.name })
      .from(t.clients)
      .orderBy(t.clients.name),
  ]);
  return (
    <>
      <Section
        title="Provision a user"
        description="The person signs in with your organisation's identity provider; their verified email links the account."
      >
        <ProvisionForm clients={clients} />
      </Section>
      <Section
        title={`Users (${users.length})`}
        description="Roles grant actions; client access limits which borrowers each user can see or act on."
      >
        <ul className="flex flex-col gap-4">
          {users.map((user) => (
            <li key={user.id} className="bg-card rounded-md border p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium">{user.displayName}</p>
                  <p className="text-muted-foreground text-sm">{user.email}</p>
                </div>
                <p className="text-muted-foreground text-sm">
                  {user.active ? "Active" : "Disabled"} ·{" "}
                  {user.bound ? "identity linked" : "awaiting first sign-in"} ·{" "}
                  {user.liveSessions} live session
                  {user.liveSessions === 1 ? "" : "s"}
                </p>
              </div>
              <UserControls
                user={user}
                clients={clients}
                self={user.id === session.userId}
              />
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
