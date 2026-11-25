// www.menubarreveal.com: every request answers 301 to the same path and query on the apex, over HTTPS.
// HSTS rides along so www keeps the header it sent while it served the site. Config: wrangler.toml beside this file.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = "menubarreveal.com";
    url.port = "";
    return new Response(null, {
      status: 301,
      headers: { Location: url.href, "Strict-Transport-Security": "max-age=31536000; includeSubDomains" },
    });
  },
};
