/**
 * Password hashing.
 *
 * bcrypt (pure JS) rather than argon2 — argon2 needs a native build toolchain,
 * which turns "clone and run" into "install Visual Studio Build Tools" on
 * Windows. bcrypt at cost 12 is still a perfectly sound choice here.
 */
import bcrypt from 'bcryptjs';

const COST = 12;

export const hash = (plain) => bcrypt.hash(plain, COST);
export const verify = (stored, plain) => bcrypt.compare(plain, stored);
