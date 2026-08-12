export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    const finalSegment = url.pathname.split("/").at(-1) || "";
    const isAssetOrApi = finalSegment.includes(".") || url.pathname.startsWith("/api/");

    if (
      response.status !== 404 ||
      !acceptsHtml ||
      isAssetOrApi ||
      !["GET", "HEAD"].includes(request.method)
    ) {
      return response;
    }

    const indexUrl = url;
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
