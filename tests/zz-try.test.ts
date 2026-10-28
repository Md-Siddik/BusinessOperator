import { describe, it, expect } from "vitest";
import { domainCandidates, extractFromPage } from "@/features/research/website";
import { cleanPhone } from "@/features/registry/normalize-helpers";
import { formatPhone } from "@/lib/company-fields";
describe("x", () => { it("y", () => {
  console.log(domainCandidates("ACME HOLDINGS, LLC", "US"), domainCandidates("BLUE GUM PTY. LTD.", "AU"), domainCandidates("Nowak Software sp. z o.o.", "PL"), domainCandidates("Maple Leaf Inc.", "CA"));
  console.log(cleanPhone("(212) 555-0100","US"), cleanPhone("1-800-555-0100","US"), cleanPhone("(02) 9374 4000","AU"), cleanPhone("0412 345 678","AU"), cleanPhone("+61 2 9374 4000","AU"));
  console.log(formatPhone("+12125550100"), formatPhone("+61293744000"), formatPhone("+61412345678"), formatPhone("+4791234567"), formatPhone("+48221234567"), formatPhone("+442079460958"), formatPhone("+358401234567"));
  const html = `<html><body><p>Call us: (212) 555-0100</p><a href="tel:+1-212-555-0199">x</a></body></html>`;
  console.log(extractFromPage(html, "https://acmeholdings.com/contact", "US").phones);
  expect(1).toBe(1);
});});
