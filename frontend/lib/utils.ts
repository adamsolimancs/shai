import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

const BANNED_TERMS = ["fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "coon"];

// Check if the input string contains any banned terms
export function containsBannedTerm(input: string): boolean {
  const normalized = input.toLowerCase();
  return BANNED_TERMS.some((term) => normalized.includes(term));
}
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function slugifySegment(value?: string): string {
  if (!value) {
    return "";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export function unslugifySegment(value?: string): string {
  if (!value) {
    return "";
  }
  return value
    .trim()
    .split("-")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}
