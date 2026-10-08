import { notFound } from "next/navigation";

/** Any unknown public path renders the localized not-found page. */
export default function CatchAll() {
  notFound();
}
