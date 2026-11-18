// The reverse proxy removes this build-time prefix before forwarding to Fastify.
export function appPath(path = ''): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}
