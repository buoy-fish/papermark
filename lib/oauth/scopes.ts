// STUB (buoy fork): withheld Papermark EE granular-scopes module. See FORK.md.
//
// Both are value-consumed via ARRAY-spread in pages/api/teams/[teamId]/tokens/
// index.ts (`[...PRESET_SCOPES, ...GRANULAR_SCOPES]`, POST + PATCH), so each MUST
// be an iterable array — `PRESET_SCOPES = {}` made that `TypeError: PRESET_SCOPES
// is not iterable` → every API-token create/edit 500'd. PRESET_SCOPES carries the
// two presets the handler special-cases (`apis.all` / `apis.read`) so the
// self-host token feature works; GRANULAR_SCOPES stays empty (paid per-resource
// scopes remain disabled). PRESET_SCOPES is only ever array-spread, never keyed.
export const GRANULAR_SCOPES: any[] = [];
export const PRESET_SCOPES: any[] = ["apis.all", "apis.read"];
