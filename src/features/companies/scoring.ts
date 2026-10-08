import type { LeadScoringSettings, ScoringRuleId } from "@/features/settings/schemas";
import type { ScoreItem } from "@/models";

/** The fields scoring reads — works for documents and normalized registry records. */
export type ScorableCompany = {
  registrationDate?: Date | string | null;
  industry?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  legalForm?: string | null;
  socialLinks?: unknown[] | null;
  signals?: { hiring?: boolean | null } | null;
  auditSummary?: { score?: number | null; https?: boolean | null; mobileFriendly?: boolean | null } | null;
};

/**
 * Digital opportunity = a concrete, observable gap we could help with:
 * no website, or an audited website that scores poorly / lacks HTTPS / isn't mobile-friendly.
 */
export function hasDigitalOpportunity(c: ScorableCompany): boolean {
  if (!c.website) return true;
  const a = c.auditSummary;
  if (!a || a.score == null) return false;
  return a.score < 50 || a.https === false || a.mobileFriendly === false;
}

function daysSince(date: Date | string | null | undefined, now: Date) {
  if (!date) return Infinity;
  return (now.getTime() - new Date(date).getTime()) / 86_400_000;
}

const RULES: Record<ScoringRuleId, (c: ScorableCompany, s: LeadScoringSettings, now: Date) => boolean> = {
  newly_registered: (c, s, now) => daysSince(c.registrationDate, now) <= s.newlyRegisteredDays,
  relevant_industry: (c, s) => !!c.industry && (s.relevantIndustries as string[]).includes(c.industry),
  no_website: (c) => !c.website,
  weak_website: (c) => !!c.website && c.auditSummary?.score != null && c.auditSummary.score < 50,
  email_available: (c) => !!c.email,
  phone_available: (c) => !!c.phone,
  hiring: (c) => c.signals?.hiring === true,
  digital_opportunity: (c) => hasDigitalOpportunity(c),
  limited_company: (c, s) => !!c.legalForm && s.limitedLegalForms.some((f) => f.toLowerCase() === c.legalForm!.toLowerCase()),
};

/**
 * Transparent, configurable lead score. Every point is explained in the
 * breakdown; the total is clamped to 0–100.
 */
export function scoreCompany(c: ScorableCompany, settings: LeadScoringSettings, now = new Date()) {
  const breakdown: ScoreItem[] = [];
  for (const rule of settings.rules) {
    if (!rule.enabled) continue;
    const evaluate = RULES[rule.id];
    if (evaluate && evaluate(c, settings, now)) breakdown.push({ ruleId: rule.id, label: rule.label, points: rule.points });
  }
  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, breakdown, qualified: score >= settings.qualifiedThreshold, digitalOpportunity: hasDigitalOpportunity(c) };
}
