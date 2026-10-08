import { LANGUAGE_CODES } from "@/config/languages";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { getPath } from "@/lib/i18n/translator";
import { LocalizedNotFound } from "@/components/site/localized-not-found";

/** not-found.tsx receives no params, so strings for every locale are passed and chosen client-side from the URL. */
export default function NotFound() {
  const strings = Object.fromEntries(
    LANGUAGE_CODES.map((code) => {
      const m = getBaseMessages(code);
      return [code, { title: getPath(m, "errors.notFoundTitle") as string, text: getPath(m, "errors.notFoundText") as string, back: getPath(m, "errors.backHome") as string }];
    }),
  );
  return <LocalizedNotFound strings={strings} />;
}
