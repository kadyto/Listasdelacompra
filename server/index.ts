import { createApp } from "./app.js";
const app = await createApp({
  logger: true,
  updater: {
    activate: () => {
      setTimeout(() => {
        app
          .close()
          .then(() => process.exit(75))
          .catch((error) => {
            app.log.error(error);
            process.exit(1);
          });
      }, 300);
    },
  },
});
const port = Number(process.env.PORT ?? 3000);
if (
  !Number.isInteger(port) ||
  port < (process.env.APP_PREFLIGHT === "1" ? 0 : 1) ||
  port > 65535
)
  throw new Error("PORT debe ser un puerto entre 1 y 65535.");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app
      .close()
      .then(() => process.exit(0))
      .catch((error) => {
        app.log.error(error);
        process.exit(1);
      });
  });
}
try {
  await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
  const health = await app.inject({ method: "GET", url: "/api/health" });
  if (health.statusCode !== 200)
    throw new Error("La base de datos no supera la comprobación de salud.");
  process.send?.({ type: "ready" });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
