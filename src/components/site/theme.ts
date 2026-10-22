/** Public-site appearance modes (see src/app/site-theme.css). Mixed is the default for first-time visitors. */
export const SITE_THEMES = ["dark", "light", "mixed"] as const;
export type SiteTheme = (typeof SITE_THEMES)[number];
export const DEFAULT_SITE_THEME: SiteTheme = "mixed";
export const SITE_THEME_STORAGE_KEY = "et-theme";

/**
 * Runs in <head> before the first paint: applies the visitor's saved choice so the page never
 * flashes the wrong theme, while pages stay statically rendered with the default.
 */
export const SITE_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(SITE_THEME_STORAGE_KEY)});if(${JSON.stringify(SITE_THEMES)}.indexOf(t)>-1)document.documentElement.setAttribute("data-site-theme",t)}catch(e){}})();`;
