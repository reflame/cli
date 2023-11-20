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

  const secret = process.env.REFLAME_SECRET;

  if (!secret) {
    throw new Error("missing REFLAME_SECRET environment variable");
  }

  const appId = config.appId;

  const fetchAccessTokenPromise = fetch(
    "https://identity.reflame.cloud/cli/exchange-secret",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        appId,
        secret,
      }),
    }
  ).then((response) => response.json());

  // TODO: prep npm package bundle ahead of time

  const sourceDirectory = path_.join(workingDirectory, config.sourceDirectory);
  const paths = await fastGlob_([`${sourceDirectory}/**/*`], {
    ignore: ["**/**.d.ts", "**/.*/**/*", "**/node_modules/**/*"],
  });

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

  const resourcesWithoutData = resources.map(
    ({ data, ...resource }) => resource
  );

  console.log(resourcesWithoutData);

  const { accessToken } = await fetchAccessTokenPromise;
  if (!accessToken) {
    throw new Error("failed to get access token");
  }
  const { resourceMissingByPathnameApp } = await fetch(
    "https://deployer.reflame.cloud/cli/get-resources-missing",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        appId,
        resourcesWithoutData,
      }),
    }
  ).then((response) => response.json());

  await fetch(
    Object.assign(
      new URL("https://deployer.reflame.cloud/cli/deploy-and-run-tests"),
      {
        search: new URLSearchParams({
          appId,
        }),
      }
    ),
    {
      method: "POST",
      headers: {
        "content-type": "application/cbor",
        authorization: `Bearer ${accessToken}`,
      },
      // TODO: body
    }
  ).then((response) => response.json());

  // TODO: trigger a deploy sending only reflame config, package.json, missing resources
  // Need to save installation id for each app installed with the minimal-access github app
  // can eagerly update during installation process?
  // Might also need to add single file access to reflame config to identify app id
  // if we need to do this exclusively through webhooks...

  console.log(resourceMissingByPathnameApp);
})();
