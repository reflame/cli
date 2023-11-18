import * as jsoncParser_ from "jsonc-parser";
import * as fs_ from "node:fs/promises";
import * as path_ from "node:path";
import fastGlob_ from "fast-glob";
import * as libResource_ from "@reflame/lib-resource";

(async () => {
  const workingDirectory = process.cwd();
  const config = jsoncParser_.parse(
    await fs_.readFile(path_.join(workingDirectory, ".reflame.config.jsonc"), {
      encoding: "utf-8",
    })
  );

  const sourceDirectory = path_.join(workingDirectory, config.sourceDirectory);
  const paths = await fastGlob_([`${sourceDirectory}/**/*`], {
    ignore: ["**/**.d.ts", "**/.*/**/*", "**/node_modules/**/*"],
  });

  console.log({ paths });

  const resources = (
    await Promise.all(
      paths.map(async (path) => {
        const pathname = `/${path_.relative(sourceDirectory, path)}`;
        const contentType = libResource_.lookupContentType(pathname);

        if (!contentType) return;

        const meta = libResource_.meta({
          headers: {
            contentType,
          },
        });

        const data = await fs_.readFile(path);

        const id = await libResource_.id({ data, meta });

        return { pathname, id, data, meta };
      })
    )
  )
    .filter((resource) => !!resource)
    .sort((a, b) => (a.pathname < b.pathname ? -1 : 1));

  const ids = resources.map(({ id }) => id);

  console.log(ids);
})();
