import { z } from "zod";
import { Types } from "mongoose";
import { COUNTRY_CODES } from "@/config/countries";
import { LANGUAGE_CODES } from "@/config/languages";
import { Errors } from "@/lib/errors";

export const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), "Invalid id");

/** Parse an id from a URL; invalid ids are treated as "not found" (never 500). */
export function parseObjectId(value: string | undefined | null): Types.ObjectId {
  if (!value || !Types.ObjectId.isValid(value)) throw Errors.notFound();
  return new Types.ObjectId(value);
}

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address"));

export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .regex(/^\+?[0-9 ()\-.]{5,40}$/, "Enter a valid phone number");

export const optionalPhone = z
  .union([phoneSchema, z.literal("")])
  .optional()
  .transform((v) => v || undefined);

export const urlSchema = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .pipe(z.url("Enter a valid URL"))
  .refine((v) => /^https?:\/\//i.test(v), "Only http(s) URLs are allowed");

export const optionalUrl = z
  .union([urlSchema, z.literal("")])
  .optional()
  .transform((v) => v || undefined);

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => COUNTRY_CODES.includes(v), "Unsupported country");

/** Any ISO-3166 alpha-2 code (contact forms / clients outside intelligence countries). */
export const isoCountrySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Select a country");

export const languageCodeSchema = z.string().refine((v) => (LANGUAGE_CODES as string[]).includes(v), "Unsupported language");

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(200);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number };

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
