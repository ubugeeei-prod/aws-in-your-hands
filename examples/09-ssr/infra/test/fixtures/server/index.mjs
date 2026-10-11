// Stands in for .output/server in the stack tests, which must not need a Nuxt build.
export const handler = async () => ({ statusCode: 200, body: "fixture" });
