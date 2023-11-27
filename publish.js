import * as fs_ from "node:fs/promises";
import * as pacote_ from "pacote";
import * as arborist_ from "@npmcli/arborist";
import * as libNpmPublish_ from "libnpmpublish";
import * as path_ from "node:path";
const packageJson = JSON.parse(
  await fs_.readFile("./package.json", { encoding: "utf-8" })
);
const packagePath = path_.resolve(process.cwd(), "./packages/@reflame/cli");
await fs_.mkdir(packagePath, { recursive: true });
// await fs_.mkdir("./packages/reflame-cli", { recursive: true });

await Promise.all([
  fs_.cp("./build/deps.mjs", `${packagePath}/deps.mjs`),
  fs_
    .readFile("./build/entry.mjs", { encoding: "utf-8" })
    .then((code) =>
      fs_.writeFile(`${packagePath}/entry.mjs`, `#!/usr/bin/env node\n${code}`)
    ),
  fs_.writeFile(
    `${packagePath}/package.json`,
    JSON.stringify(
      {
        name: packageJson.name,
        version: packageJson.version,
        bin: {
          reflame: "./entry.mjs",
        },
      },
      undefined,
      "  "
    )
  ),
]);

const manifest = await pacote_.manifest(packagePath);
const tarData = await pacote_.tarball(packagePath, {
  Arborist: arborist_.Arborist,
});

try {
  await libNpmPublish_.publish(manifest, tarData, {
    npmVersion: `${packageJson.name}@${packageJson.version}`,
    forceAuth: {
      token: process.env.NPM_TOKEN,
    },
    access: "public",
  });
  console.log(`Published ${packageJson.version}`);
} catch (error) {
  if (
    error.message.endsWith(
      `You cannot publish over the previously published versions: ${packageJson.version}.`
    )
  ) {
    console.log(`Skipped ${packageJson.version}`);
  } else {
    throw error;
  }
}

// https://github.com/npm/cli/tree/latest/workspaces/libnpmpublish
