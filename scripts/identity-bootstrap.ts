/**
 * Provision the first administrator (or any user) from the server side (#109).
 * There is no self-registration; later users are provisioned in /admin/users.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/identity-bootstrap.ts \
 *     --email admin@bank.example --name "Ops Admin" --roles ADMIN [--clients cli_0001,cli_0002]
 */
import { parseArgs } from "node:util";

import { closeDb, getDb } from "@/lib/db/client";
import { NewUserInput, provisionUser } from "@/lib/identity/admin";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    roles: { type: "string", default: "ADMIN" },
    clients: { type: "string", default: "" },
  },
});

async function main() {
  const tenantId = process.env.CREDIT_DESK_TENANT_ID;
  if (!tenantId) throw new Error("CREDIT_DESK_TENANT_ID is required");
  const input = NewUserInput.parse({
    email: values.email,
    displayName: values.name,
    roles: values.roles!.split(",").filter(Boolean),
    clientIds: values.clients!.split(",").filter(Boolean),
  });
  const result = await provisionUser(
    await getDb(),
    { userId: "system:bootstrap", tenantId },
    input,
  );
  await closeDb();
  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify({
      event: "user_provisioned",
      userId: result.userId,
      roles: input.roles,
    }),
  );
}

void main();
