import { ffmpeg } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import { pythonExtension } from "@trigger.dev/python/extension";
import { defineConfig, timeout } from "@trigger.dev/sdk";

export default defineConfig({
  // buoy.fish self-host: the "papermark" project on jobs.buoy.fish
  project: "proj_qhaoaqnjfzzxibridnds",
  // Self-host: only core conversion tasks. The ee/**/lib/trigger dirs are
  // excluded — the AI tasks construct OpenAI clients at import and abort
  // indexing without OPENAI_API_KEY, and all EE features are out of scope.
  dirs: ["./lib/trigger"],
  maxDuration: timeout.None, // no max duration
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    external: ["mupdf"],
    extensions: [
      prismaExtension({
        mode: "legacy",
        schema: "prisma/schema/schema.prisma",
      }),
      ffmpeg(),
      pythonExtension({
        scripts: ["./**/*.py"],
      }),
    ],
  },
});
