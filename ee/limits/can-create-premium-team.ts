// STUB (buoy fork): withheld Papermark EE module, replaced with a no-op so the
// OSS tree builds. Disables this paid-tier feature. See FORK.md.
export const PREMIUM_TEAM_LIMIT = 0;
export const getPremiumTeamEligibility = async (..._args: any[]): Promise<any> => ({ eligible: false, count: 0, limit: PREMIUM_TEAM_LIMIT });
