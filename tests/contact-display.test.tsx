import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactValue } from "@/components/intel/contact-value";
import { csvCell } from "@/features/companies/registrations";
import { formatPhone } from "@/lib/company-fields";

/**
 * Acceptance criteria: the dashboard shows the actual email / phone / website
 * values (not icons), and missing values are stated plainly without links.
 */
describe("Contact values are visible, copyable and actionable", () => {
  it("shows the actual email with Copy and Email actions", () => {
    const html = renderToStaticMarkup(<ContactValue kind="email" value="post@fjord-digital.example" sourceKind="REGISTRY" />);
    expect(html).toContain("post@fjord-digital.example");
    expect(html).toContain("Copy");
    expect(html).toContain('href="mailto:post@fjord-digital.example"');
    expect(html).toContain("Registry");
  });

  it("shows the actual phone number with Copy and Call actions", () => {
    const html = renderToStaticMarkup(<ContactValue kind="phone" value="+4722334455" />);
    expect(html).toContain("+47 223 34 455");
    expect(html).toContain('href="tel:+4722334455"');
  });

  it("shows the website as text with an Open action", () => {
    const html = renderToStaticMarkup(<ContactValue kind="website" value="https://www.fjord-digital.example" />);
    expect(html).toContain("fjord-digital.example");
    expect(html).toContain('target="_blank"');
  });

  it("missing values say so — no icon link, no mailto/tel", () => {
    const html = renderToStaticMarkup(<ContactValue kind="email" />);
    expect(html).toContain("Not available from registry");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<svg");
    const phone = renderToStaticMarkup(<ContactValue kind="phone" missing="Not available from registry" />);
    expect(phone).not.toContain("tel:");
  });

  it("demo rows never link out", () => {
    const html = renderToStaticMarkup(<ContactValue kind="email" value="hello@demo.example" disabledActions />);
    expect(html).toContain("hello@demo.example");
    expect(html).not.toContain("mailto:");
  });

  it("formats Norwegian numbers for reading but keeps the copyable value", () => {
    expect(formatPhone("+4791234567")).toBe("+47 912 34 567");
    expect(formatPhone("22 33 44 55")).toBe("22 33 44 55");
  });
});

describe("CSV export cells", () => {
  it("neutralizes spreadsheet formulas but keeps phone numbers intact", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(csvCell("+4722334455")).toBe('"+4722334455"');
    expect(csvCell(undefined)).toBe('""');
  });
});
