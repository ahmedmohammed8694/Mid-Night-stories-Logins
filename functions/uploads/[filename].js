// functions/uploads/[filename].js — Serve images uploaded to Cloudflare R2 object storage at the expected `/uploads/*` path

export async function onRequestGet(context) {
  const { env, params } = context;
  const filename = params.filename;

  if (!filename) {
    return new Response('File name not specified', { status: 400 });
  }

  // Check if R2 bucket binding exists
  if (!env.IMAGES) {
    return new Response('R2 IMAGES bucket binding is missing', { status: 500 });
  }

  // Fetch the image from Cloudflare R2
  const object = await env.IMAGES.get(filename);

  if (!object) {
    return new Response('Image not found', { status: 404 });
  }

  // Set HTTP headers (content-type, content-length, etag, and caching)
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable'); // Cache aggressively for 1 year

  return new Response(object.body, {
    headers,
    status: 200
  });
}
