import 'server-only';
import { and, eq, gt, lte, ne, sql } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { baPasskeyChallenges, baPasskeys, baSessions, userAuthLinks, users } from '@/lib/db/schema';
import { PASSKEY_MAX_CREDENTIALS, type PasskeySummary } from '@/lib/auth/passkey-contract';

export type PasskeyRow = typeof baPasskeys.$inferSelect;
type Challenge = typeof baPasskeyChallenges.$inferSelect;
type Owner = { rpId: string; authUserId: string };
export type PasskeyActor = Owner & { sessionId: string; businessUserId: number };

const ownerFilter = ({ rpId, authUserId }: Owner) =>
  and(eq(baPasskeys.rpId, rpId), eq(baPasskeys.authUserId, authUserId));

function usableAccount(authUserId: string) {
  return sql`exists (
    select 1 from ${userAuthLinks}
    join ${users} on ${users.id} = ${userAuthLinks.businessUserId}
    where ${userAuthLinks.authUserId} = ${authUserId}
      and trim(coalesce(${users.isBanned}, '')) = ''
  )`;
}

function activeActor(actor: PasskeyActor) {
  return and(usableAccount(actor.authUserId), sql`exists (
    select 1 from ${baSessions}
    where ${baSessions.id} = ${actor.sessionId}
      and ${baSessions.userId} = ${actor.authUserId}
      and ${baSessions.expiresAt} > unixepoch()
  )`);
}

function activeProof(actor: PasskeyActor, confirmedByPasskeyId: string | null) {
  if (!confirmedByPasskeyId) return undefined;
  return sql`exists (select 1 from ${baPasskeys}
    where ${ownerFilter(actor)} and ${baPasskeys.id} = ${confirmedByPasskeyId})`;
}

export function listOwnedPasskeys(db: AppDrizzleDb, owner: Owner) {
  return db.select().from(baPasskeys).where(ownerFilter(owner))
    .orderBy(baPasskeys.createdAt, baPasskeys.id).limit(PASSKEY_MAX_CREDENTIALS + 1).all();
}

export function findPasskey(db: AppDrizzleDb, rpId: string, credentialId: string) {
  return db.select().from(baPasskeys)
    .where(and(eq(baPasskeys.rpId, rpId), eq(baPasskeys.credentialId, credentialId))).get();
}

export function toPasskeySummary({ id, name, createdAt, lastUsedAt }: PasskeySummary): PasskeySummary {
  return { id, name, createdAt, lastUsedAt };
}

export async function savePasskeyChallenge(db: AppDrizzleDb, challenge: Challenge, now: number) {
  const expired = db.select({ id: baPasskeyChallenges.id }).from(baPasskeyChallenges)
    .where(lte(baPasskeyChallenges.expiresAt, now)).orderBy(baPasskeyChallenges.expiresAt).limit(24);
  await db.batch([
    db.delete(baPasskeyChallenges).where(sql`${baPasskeyChallenges.id} in (${expired})`),
    db.insert(baPasskeyChallenges).values(challenge),
  ]);
}

export async function consumePasskeyChallenge(
  db: AppDrizzleDb,
  key: Pick<Challenge, 'id' | 'rpId' | 'purpose' | 'binding'>,
  now: number,
): Promise<Challenge | undefined> {
  const [challenge] = await db.delete(baPasskeyChallenges)
    .where(and(
      eq(baPasskeyChallenges.id, key.id),
      eq(baPasskeyChallenges.rpId, key.rpId),
      eq(baPasskeyChallenges.purpose, key.purpose),
      eq(baPasskeyChallenges.binding, key.binding),
      gt(baPasskeyChallenges.expiresAt, now),
    )).returning();
  return challenge;
}

export function addPasskey(
  db: AppDrizzleDb,
  actor: PasskeyActor,
  newPasskey: Omit<PasskeyRow, 'authUserId' | 'rpId' | 'lastUsedAt'>,
  confirmedByPasskeyId: string | null,
) {
  const count = sql`(select count(*) from ${baPasskeys} where ${ownerFilter(actor)})`;
  // 容量、会话和重新确认所用凭据与写入在同一条语句中检查。
  return db.get<{ id: string }>(sql`
    insert into ${baPasskeys} (id, rp_id, auth_user_id, credential_id, public_key, counter, device_type, transports, name, created_at)
    select ${newPasskey.id}, ${actor.rpId}, ${actor.authUserId}, ${newPasskey.credentialId}, ${newPasskey.publicKey},
      ${newPasskey.counter}, ${newPasskey.deviceType}, ${JSON.stringify(newPasskey.transports)},
      ${newPasskey.name}, ${newPasskey.createdAt}
    where ${and(activeActor(actor), activeProof(actor, confirmedByPasskeyId), sql`${count} < ${PASSKEY_MAX_CREDENTIALS}`)}
    on conflict(rp_id, credential_id) do nothing
    returning id
  `);
}

export async function renamePasskey(db: AppDrizzleDb, actor: PasskeyActor, id: string, name: string) {
  const [result] = await db.update(baPasskeys).set({ name })
    .where(and(ownerFilter(actor), eq(baPasskeys.id, id), activeActor(actor))).returning({ id: baPasskeys.id });
  return result;
}

export async function deletePasskey(
  db: AppDrizzleDb,
  actor: PasskeyActor,
  id: string,
  confirmedByPasskeyId: string | null,
) {
  // 两次并行删除均选择通行密钥确认时，最后一把仍须由密码确认。
  const otherPasskey = confirmedByPasskeyId
    ? sql`exists (select 1 from ${baPasskeys} where ${and(ownerFilter(actor), ne(baPasskeys.id, id))})`
    : undefined;
  const [result] = await db.delete(baPasskeys)
    .where(and(ownerFilter(actor), eq(baPasskeys.id, id), activeActor(actor),
      activeProof(actor, confirmedByPasskeyId), otherPasskey))
    .returning({ id: baPasskeys.id });
  return result;
}

export async function recordPasskeyUse(
  db: AppDrizzleDb,
  passkey: PasskeyRow,
  counter: number,
  now: number,
) {
  const [result] = await db.update(baPasskeys)
    .set({ counter, lastUsedAt: sql`max(coalesce(${baPasskeys.lastUsedAt}, 0), ${now})` })
    .where(and(eq(baPasskeys.id, passkey.id), eq(baPasskeys.counter, passkey.counter), usableAccount(passkey.authUserId)))
    .returning({ id: baPasskeys.id });
  return result;
}
