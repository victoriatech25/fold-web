import { hash, verify, type Options } from "@node-rs/argon2";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import {
  adjacencyGraphs,
  dictionary,
} from "@zxcvbn-ts/language-common";

const MIN_PASSWORD_LENGTH = 15;
const MAX_PASSWORD_LENGTH = 128;

const ARGON2_OPTIONS = {
  algorithm: 2,
  version: 1,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

const passwordAnalyzer = new ZxcvbnFactory({
  dictionary,
  graphs: adjacencyGraphs,
});

const applicationPasswordTerms = [
  "fold",
  "fold_web",
  "victoria",
  "victoriatech",
  "hicomtech",
  "도면",
  "절곡",
];

let dummyPasswordHashPromise: Promise<string> | undefined;

export type PasswordPolicyResult =
  | { valid: true }
  | {
      valid: false;
      reason: "TOO_SHORT" | "TOO_LONG" | "COMMON_PASSWORD";
    };

export function validatePasswordPolicy(
  password: string,
  userInputs: string[] = [],
): PasswordPolicyResult {
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH) {
    return { valid: false, reason: "TOO_SHORT" };
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return { valid: false, reason: "TOO_LONG" };
  }

  const normalized = password.normalize("NFKC").toLocaleLowerCase("en-US");
  if (applicationPasswordTerms.includes(normalized)) {
    return { valid: false, reason: "COMMON_PASSWORD" };
  }

  const analysis = passwordAnalyzer.check(password, [
    ...applicationPasswordTerms,
    ...userInputs,
  ]);
  if (analysis.score === 0) {
    return { valid: false, reason: "COMMON_PASSWORD" };
  }

  return { valid: true };
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPasswordHash(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

async function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHashPromise ??= hashPassword(
    "dummy credential used only for equalized verification",
  );
  return dummyPasswordHashPromise;
}

export async function verifyPasswordOrDummy(
  passwordHash: string | null,
  password: string,
): Promise<boolean> {
  return verifyPasswordHash(
    passwordHash ?? (await getDummyPasswordHash()),
    password,
  );
}

export const passwordHashAlgorithm = "argon2id-v19";
