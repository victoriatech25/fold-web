import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * worker를 단일 ESM 파일로 묶는다. Next.js standalone 출력과 같은 이미지에 넣어
 * 진입점만 다른 컨테이너로 띄우기 위해서다(`D2-B01-B`).
 *
 * Prisma client와 native 모듈은 묶지 않는다. 생성된 client는 engine 파일을 경로로
 * 찾으므로 번들 안에 넣으면 깨진다. standalone 출력의 node_modules에 이미 들어 있다.
 */
await build({
  entryPoints: [path.join(rootDirectory, "src/worker/main.ts")],
  outfile: path.join(rootDirectory, ".next/standalone/worker.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // `server-only`는 worker에서 아무 일도 하지 않아야 한다. Next는 react-server
  // 조건으로 이를 비우는데, 번들에서는 조건 대신 직접 빈 모듈로 바꾼다.
  conditions: ["react-server", "node"],
  // standalone 출력의 node_modules에 실제로 들어가는 것만 external로 둔다.
  // `@prisma/adapter-pg`와 생성된 Prisma client는 Next도 서버 청크에 함께 묶으므로
  // worker 번들에도 포함시킨다. external로 두면 컨테이너에서 찾지 못한다.
  external: [
    "@prisma/client",
    "pg",
    "@node-rs/argon2",
    // dotenv는 개발 편의용이라 production에서는 불러오지 않는다(main.ts의 가드 참고).
    "dotenv",
  ],
  alias: {
    "@": path.join(rootDirectory, "src"),
  },
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});
