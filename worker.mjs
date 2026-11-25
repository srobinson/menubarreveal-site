// menubarreveal.com, the home page only: one address, two representations. A client that asks for Markdown
// (Accept: text/markdown) gets index.md; every other client gets the page, exactly as the files alone would serve it.
// Every other path never reaches this script: wrangler.toml runs it for "/" alone, and the files answer the rest.
// Both answers come from the files (env.ASSETS), so each carries what _headers gives its file, the security headers
// among them, and its own ETag. Both say Vary: Accept, so a cache keeps the two apart.
// tools/serve.mjs runs this same script for "/" locally.

// Markdown is wanted when the Accept header names text/markdown with a weight above zero and no smaller than the
// weight it gives text/html by name. No browser names text/markdown, and */* alone does not ask for it.
const weight = (accept, type) => {
  for (const part of accept.toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim());
    if (name !== type) continue;
    const q = params.find((p) => p.startsWith('q='));
    return q ? Number(q.slice(2)) || 0 : 1;
  }
  return 0;
};
const wantsMarkdown = (accept) => weight(accept, 'text/markdown') > 0 && weight(accept, 'text/markdown') >= weight(accept, 'text/html');

export default {
  async fetch(request, env) {
    const markdown = wantsMarkdown(request.headers.get('Accept') ?? '');
    const served = await env.ASSETS.fetch(markdown ? new Request(new URL('/index.md', request.url), request) : request);
    const response = new Response(served.body, served);
    response.headers.append('Vary', 'Accept');
    if (markdown) {
      // _headers keeps the file /index.md out of search as a duplicate of the home page. Here it is the home page, so it
      // takes the home page's word on indexing and its links instead (on the preview that word is noindex, nofollow).
      const home = await env.ASSETS.fetch(new Request(request.url, { method: 'HEAD' }));
      for (const name of ['X-Robots-Tag', 'Link']) {
        if (home.headers.has(name)) response.headers.set(name, home.headers.get(name));
        else response.headers.delete(name);
      }
    }
    return response;
  },
};
