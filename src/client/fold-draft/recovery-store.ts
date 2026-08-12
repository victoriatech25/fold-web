import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import type { ServerFoldDocument } from "@/domain/fold-document/schema";

const DATABASE_NAME = "fold-web-draft-recovery-v1";
const STORE_NAME = "drafts";
const pendingOperations = new Map<string, Promise<void>>();

export type FoldDraftRecoveryRecord = {
  key: string;
  organizationId: string;
  userId: string;
  draftId: string;
  document: ServerFoldDocument;
  baseLockVersion: number;
  baseChecksum: string;
  localChecksum: string;
  savedAt: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function recoveryKey(
  organizationId: string,
  userId: string,
  draftId: string,
): string {
  return `${organizationId}:${userId}:${draftId}`;
}

function enqueueOperation(
  key: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = pendingOperations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  pendingOperations.set(key, next);
  const cleanup = () => {
    if (pendingOperations.get(key) === next) pendingOperations.delete(key);
  };
  void next.then(cleanup, cleanup);
  return next;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function putFoldDraftRecovery(input: {
  organizationId: string;
  userId: string;
  draftId: string;
  document: ServerFoldDocument;
  baseLockVersion: number;
  baseChecksum: string;
}): Promise<FoldDraftRecoveryRecord> {
  const key = recoveryKey(input.organizationId, input.userId, input.draftId);
  const record: FoldDraftRecoveryRecord = {
    key,
    ...input,
    localChecksum: await sha256(projectCanonicalJsonV1(input.document)),
    savedAt: new Date().toISOString(),
  };
  await enqueueOperation(key, async () => {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  return record;
}

export async function getFoldDraftRecovery(input: {
  organizationId: string;
  userId: string;
  draftId: string;
}): Promise<FoldDraftRecoveryRecord | null> {
  const key = recoveryKey(input.organizationId, input.userId, input.draftId);
  await pendingOperations.get(key)?.catch(() => undefined);
  const database = await openDatabase();
  const record = await new Promise<FoldDraftRecoveryRecord | undefined>(
    (resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction
        .objectStore(STORE_NAME)
        .get(key);
      request.onsuccess = () => resolve(
        request.result as FoldDraftRecoveryRecord | undefined,
      );
      request.onerror = () => reject(request.error);
    },
  );
  database.close();
  return record ?? null;
}

export async function deleteFoldDraftRecovery(input: {
  organizationId: string;
  userId: string;
  draftId: string;
}): Promise<void> {
  const key = recoveryKey(input.organizationId, input.userId, input.draftId);
  await enqueueOperation(key, async () => {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
}
