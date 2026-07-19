import { createInterface } from "node:readline/promises";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

export function createCliPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      application_name: "fold_web_auth_cli",
    }),
  });
}

export function readNamedArguments(
  arguments_: string[],
  allowed: readonly string[],
): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Arguments must use --name value pairs.");
    }
    const name = key.slice(2);
    if (!allowed.includes(name) || values.has(name)) {
      throw new Error(`Unknown or duplicate argument: ${key}`);
    }
    values.set(name, value);
  }
  return values;
}

export function requireArgument(
  values: Map<string, string>,
  name: string,
): string {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

async function readHiddenLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    const input = await new Promise<string>((resolve, reject) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        value += chunk;
      });
      process.stdin.on("end", () => resolve(value));
      process.stdin.on("error", reject);
      process.stdin.resume();
    });
    return input.replace(/\r?\n$/, "");
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

export async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    const first = await readHiddenLine("비밀번호: ");
    const second = await readHiddenLine("비밀번호 확인: ");
    if (first !== second) throw new Error("Passwords do not match.");
    return first;
  }
  return readHiddenLine("");
}

export async function confirmAction(question: string): Promise<void> {
  if (!process.stdin.isTTY) return;
  const interface_ = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await interface_.question(`${question} [yes/no] `);
    if (answer.trim().toLowerCase() !== "yes") {
      throw new Error("Cancelled.");
    }
  } finally {
    interface_.close();
  }
}
