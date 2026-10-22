import { Inter, Instrument_Serif, Manrope } from "next/font/google";

export const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });
export const instrumentSerif = Instrument_Serif({ subsets: ["latin", "latin-ext"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument", display: "swap" });
/** Display face for public-site headings (h1, h2). */
export const manrope = Manrope({ subsets: ["latin", "latin-ext"], variable: "--font-manrope", display: "swap" });

export const fontVariables = `${inter.variable} ${instrumentSerif.variable}`;
/** The public website adds the display face; the dashboard does not load it. */
export const siteFontVariables = `${fontVariables} ${manrope.variable}`;
