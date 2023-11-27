import { jsoncParser_, fastGlob_, libResource_, cborX_ } from "./deps.mjs";

import * as fs_ from "node:fs/promises";
import * as path_ from "node:path";
import * as childProcess_ from "node:child_process";

const execPromise = (command: string) => {
  return new Promise((resolve, reject) => {
    childProcess_.exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(`Execution error: ${error}`);
        return;
      }
      if (stderr) {
        reject(`Error: ${stderr}`);
        return;
      }
      resolve(stdout);
    });
  });
};

(async () => {
  const commit =
    process.env.NODE_ENV === "development"
      ? "c096f9dcc14963cd9742075eb37a2cdf1714dfe5"
      : (process.env.GITHUB_SHA as string);

  const branch =
    process.env.NODE_ENV === "development"
      ? "main"
      : (process.env.GITHUB_REF_NAME as string);

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

  const commitsLatestPromise =
    process.env.NODE_ENV === "development"
      ? // This doesn't work in gh actions with shallow clone
        execPromise(`git rev-list -n 32 ${commit}`).then((output) =>
          (output as string)
            .split("\n")
            .slice(
              // Remove head commit
              1,
              // Handle final newline

              -1
            )
            .join(",")
        )
      : // We fetch from github API instead of deep cloning to save on cloning time
        fetch("https://api.github.com/graphql", {
          method: "POST",
          headers: {
            accept: "application/vnd.github.v3+json",
            authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "X-Github-Next-Global-ID": "1",
          },
          body: JSON.stringify({
            query: `
      query {
        repository(owner: "${process.env.GITHUB_REPOSITORY_OWNER}", name: "${
              process.env.GITHUB_REPOSITORY?.split("/")[1]
            }") {
          object(oid: "${commit}") {
            ... on Commit {
              history(first: 32) {
                nodes {
                  oid
                }
              }
            }
          }
        }
      }`,
          }),
        })
          .then((response) => response.json())
          .then((payload) =>
            payload.data.repository.object.history.nodes
              .map(({ oid }) => oid)
              .slice(1)
          );

  // TODO: prep npm package bundle ahead of time

  const sourceDirectory = path_.join(workingDirectory, config.sourceDirectory);

  const paths = await fastGlob_([`${sourceDirectory}/**/*`], {
    ignore: ["**/**.d.ts", "**/.*/**/*", "**/node_modules/**/*"],
  });

  console.log(`Found files matching pattern: ${sourceDirectory}/**/*`, paths);

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
    .filter((resource): resource is NonNullable<typeof resource> => !!resource)
    .sort((a, b) => (a.pathname < b.pathname ? -1 : 1));

  const resourcesWithoutData = resources.map(
    ({ data, ...resource }) => resource
  );

  const accessToken = (await fetchAccessTokenPromise)?.accessToken;
  if (!accessToken) {
    throw new Error("Failed to fetch access token");
  }
  console.log("Got a new access token from Reflame.");

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

  Object.keys(resourceMissingByPathnameApp).length > 0
    ? console.log(
        `Found some new files for Reflame to process:`,
        Object.keys(resourceMissingByPathnameApp).map((pathname) =>
          path_.join(sourceDirectory, pathname)
        )
      )
    : console.log(`Found no new files for Reflame to process.`);

  const payloadPrimary = {
    config,
  };

  const payloadSecondary = {};

  const payloadResources = resources.map(({ data, ...resource }) => ({
    resource: {
      ...resource,
      data: resourceMissingByPathnameApp[resource.pathname] ? data : undefined,
    },
  }));

  const encoder = new cborX_.Encoder({ sequential: true });

  const body = Buffer.concat([
    encoder.encode(payloadPrimary),
    encoder.encode(payloadSecondary),
    ...payloadResources.map((payloadResource) =>
      encoder.encode(payloadResource)
    ),
  ]);

  const commitsLatest = await commitsLatestPromise;

  console.log(
    `Starting deployment and tests for commit ${commit} on branch ${branch}, with the following commit history:`,
    commitsLatest
  );

  const deployPromise = fetch(
    Object.assign(
      new URL("https://deployer.reflame.cloud/cli/deploy-and-run-tests"),
      {
        search: new URLSearchParams({
          appId,
          commit,
          commitsLatest,
          branch,
        }),
      }
    ),
    {
      method: "POST",
      // verbose: true,
      headers: {
        "content-type": "application/cbor",
        authorization: `Bearer ${accessToken}`,
      },
      body,
      // TODO: body
    }
  ).then((response) => response.json());

  const deployResult = await deployPromise;

  if (!deployResult.checkRunDeployUrl) {
    throw new Error("Deployment failed!" + JSON.stringify(deployResult));
  }

  console.log(
    "Deployment started! Follow along here: ",
    deployResult.checkRunDeployUrl
  );
})();
