// Shim: stage colors now live in the single source of truth (lib/stages.ts).
// Kept so existing `@/lib/stage-colors` imports (LeadCard, outreach page) don't
// have to change. Prefer importing from `@/lib/stages` in new code.
export { stageColor } from "@/lib/stages";
