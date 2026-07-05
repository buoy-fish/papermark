// STUB (buoy fork): module imported by the OSS tree but not published upstream.
// Minimal real implementations — the tokens API value-imports the schema and
// parser (`.safeParse()` on an undefined const 500s Settings → Tokens); values
// mirror prisma's RestrictedToken.subjectType comment ("user" | "machine",
// default "user"). See FORK.md.
import { z } from "zod";

export const RestrictedTokenSubjectTypeSchema = z.enum(["user", "machine"]);
export type RestrictedTokenSubjectType = z.infer<
  typeof RestrictedTokenSubjectTypeSchema
>;

export const parseRestrictedTokenSubjectType = (
  value: unknown,
): RestrictedTokenSubjectType => (value === "machine" ? "machine" : "user");

export const revokeUserBoundTeamTokens = async (
  ..._args: any[]
): Promise<void> => {};
