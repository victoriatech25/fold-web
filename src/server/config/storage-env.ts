import "server-only";

export type StorageRuntimeConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO 는 가상 호스트 방식 주소를 쓰지 않으므로 기본값이 path style 이다. */
  forcePathStyle: boolean;
  downloadUrlTtlSeconds: number;
  uploadUrlTtlSeconds: number;
  maxFileBytes: number;
};

type StorageEnvironment = Readonly<Record<string, string | undefined>>;

export class StorageEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageEnvironmentError";
  }
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new StorageEnvironmentError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new StorageEnvironmentError(`${name} is required at runtime.`);
  return value;
}

export function readStorageRuntimeConfig(
  environment: StorageEnvironment = process.env,
): StorageRuntimeConfig {
  const endpoint = requireValue(environment.STORAGE_ENDPOINT, "STORAGE_ENDPOINT");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new StorageEnvironmentError("STORAGE_ENDPOINT must be a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new StorageEnvironmentError("STORAGE_ENDPOINT must use http or https.");
  }

  const bucket = requireValue(environment.STORAGE_BUCKET, "STORAGE_BUCKET");
  // S3 bucket 이름 규칙. 로컬과 운영에서 같은 코드로 접속하므로 여기에서 막는다.
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new StorageEnvironmentError("STORAGE_BUCKET must be a valid bucket name.");
  }

  return {
    endpoint,
    region: environment.STORAGE_REGION || "us-east-1",
    bucket,
    accessKeyId: requireValue(environment.STORAGE_ACCESS_KEY_ID, "STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: requireValue(
      environment.STORAGE_SECRET_ACCESS_KEY,
      "STORAGE_SECRET_ACCESS_KEY",
    ),
    forcePathStyle: readBoolean(environment.STORAGE_FORCE_PATH_STYLE, true),
    // 만료를 짧게 둬 URL 이 새어도 쓸 수 있는 시간을 줄인다(`D2-B02-E`).
    downloadUrlTtlSeconds: readPositiveInteger(
      environment.STORAGE_DOWNLOAD_URL_TTL_SECONDS,
      300,
      "STORAGE_DOWNLOAD_URL_TTL_SECONDS",
    ),
    uploadUrlTtlSeconds: readPositiveInteger(
      environment.STORAGE_UPLOAD_URL_TTL_SECONDS,
      600,
      "STORAGE_UPLOAD_URL_TTL_SECONDS",
    ),
    maxFileBytes: readPositiveInteger(
      environment.STORAGE_MAX_FILE_BYTES,
      100 * 1024 * 1024,
      "STORAGE_MAX_FILE_BYTES",
    ),
  };
}
