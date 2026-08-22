import { spawnSync } from "node:child_process";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://fold_web_app@127.0.0.1:5432/fold_web_test?schema=public";
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
};

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "db:test:reset"]);
run(
  "npm",
  [
    "run",
    "auth:bootstrap-admin",
    "--",
    "--email",
    "e2e-admin@example.test",
    "--name",
    "브라우저 검증 관리자",
  ],
  { input: "Browser verification phrase 2026!" },
);

// 파일 저장소 bucket 을 미리 만든다. 없으면 업로드가 저장소 장애로 보인다(P2-B02).
const storageEndpoint = process.env.STORAGE_ENDPOINT ?? "http://127.0.0.1:9000";
const storageBucket = process.env.STORAGE_BUCKET ?? "fold-web-e2e";
try {
  const { S3Client, CreateBucketCommand, HeadBucketCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    endpoint: storageEndpoint,
    region: process.env.STORAGE_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? "fold-web-local",
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? "fold-web-local-secret",
    },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: storageBucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: storageBucket }));
  }
  process.stdout.write(`Storage bucket ${storageBucket} is ready.\n`);
} catch (error) {
  // 저장소가 없어도 나머지 e2e 는 돌아야 한다. 파일 시나리오만 실패한다.
  process.stdout.write(
    `Storage bucket preparation skipped (${error instanceof Error ? error.message : "unknown"}).\n`,
  );
}

process.stdout.write("Playwright test database and account are ready.\n");
