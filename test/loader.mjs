/*
 * Module resolve hook: redirect "@netlify/blobs" to the in-memory test mock so
 * the function can be tested without the Netlify runtime. Registered via
 * --experimental-loader by the "test:fn" npm script.
 */
import { pathToFileURL } from "node:url";

const MOCK = pathToFileURL(new URL("./mocks/netlify-blobs.mjs", import.meta.url).pathname).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@netlify/blobs") {
    return { url: MOCK, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
