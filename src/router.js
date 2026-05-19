export function createRouter(routes) {
  const routeMap = new Map(
    routes.map((route) => [
      `${route.method.toUpperCase()} ${route.pathname}`,
      route.handler,
    ])
  );

  return {
    async handle(request) {
      const url = new URL(request.url);
      const key = `${request.method.toUpperCase()} ${url.pathname}`;
      const handler = routeMap.get(key);

      if (!handler) {
        return null;
      }

      return handler(request, url);
    },
  };
}
