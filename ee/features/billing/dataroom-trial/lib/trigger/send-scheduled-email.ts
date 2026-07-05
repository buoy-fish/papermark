// STUB (buoy fork): withheld Papermark EE module, replaced with a no-op so the
// OSS tree builds. Disables this paid-tier feature. See FORK.md.
const noopTask: any = { trigger: async (..._a: any[]) => ({}), batchTrigger: async (..._a: any[]) => ({}) };
export const sendDataroomTrial24hReminderEmailTask = noopTask;
export const sendDataroomTrialExpiredEmailTask = noopTask;
export const sendDataroomTrialInfoEmailTask = noopTask;
