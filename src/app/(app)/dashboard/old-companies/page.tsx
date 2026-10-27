import { redirect } from "next/navigation";

/** Old company Intelligence opens on all countries. */
export default function OldCompaniesIndex() {
  redirect("/dashboard/old-companies/all");
}
