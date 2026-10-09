import { createApp } from "./app.js";
const app = await createApp({ logger: true });
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
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
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
