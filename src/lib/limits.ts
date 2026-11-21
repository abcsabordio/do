/**
 * Maximum lengths for everything a person can type.
 *
 * The same numbers are enforced by the database (supabase/migrations/
 * 005_hardening.sql), so editing them here alone isn't enough: change both.
 */
export const LIMITS = {
  taskTitle: 200,
  taskNotes: 2000,
  groupName: 80,
  // RFC 5321: the longest address a mail server has to accept.
  email: 254,
  // Supabase hashes passwords with bcrypt, which only reads the first 72 bytes.
  password: 72,
  passwordMin: 8,
} as const

/** Cut text down to `max` characters (used for guest data, which skips the database). */
export const clamp = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text)
