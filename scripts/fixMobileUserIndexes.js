/**
 * One-time DB index fix for MobileUser:
 * - Drops old unique index mobile_1_clientId_1 that conflicts on {mobile: null}
 * - Recreates partial unique indexes for (mobile, clientId) and (email, clientId)
 *
 * Usage:
 *   node scripts/fixMobileUserIndexes.js
 *
 * Requires:
 *   MONGODB_URI in environment (or .env loaded by server)
 */
require("dotenv").config();
const mongoose = require("mongoose");

async function dropIndexIfExists(col, name) {
  const indexes = await col.indexes();
  const exists = indexes.some((i) => i.name === name);
  if (!exists) {
    console.log(`[index] ${name} not found (skip drop)`);
    return;
  }
  await col.dropIndex(name);
  console.log(`[index] dropped ${name}`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  await mongoose.connect(uri);
  console.log("[db] connected");

  const col = mongoose.connection.collection("mobileusers");

  // Drop problematic index
  await dropIndexIfExists(col, "mobile_1_clientId_1");

  // Recreate with partial filter (only enforce when mobile exists)
  await col.createIndex(
    { mobile: 1, clientId: 1 },
    {
      unique: true,
      name: "mobile_1_clientId_1",
      partialFilterExpression: { mobile: { $exists: true, $type: "string" } },
    }
  );
  console.log("[index] created mobile_1_clientId_1 (partial unique)");

  // Ensure email is unique per client (partial)
  await dropIndexIfExists(col, "email_1_clientId_1");
  await col.createIndex(
    { email: 1, clientId: 1 },
    {
      unique: true,
      name: "email_1_clientId_1",
      partialFilterExpression: { email: { $exists: true, $type: "string" } },
    }
  );
  console.log("[index] created email_1_clientId_1 (partial unique)");

  const final = await col.indexes();
  console.log("[index] current indexes:");
  for (const idx of final) console.log(`- ${idx.name}`);

  await mongoose.disconnect();
  console.log("[db] disconnected");
}

main().catch(async (err) => {
  console.error("[error]", err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

