import { Inter, Instrument_Serif } from "next/font/google";

export const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });
export const instrumentSerif = Instrument_Serif({ subsets: ["latin", "latin-ext"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument", display: "swap" });

export const fontVariables = `${inter.variable} ${instrumentSerif.variable}`;
