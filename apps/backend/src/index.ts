import { createApp } from "./app.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "4000", 10);

const app = await createApp();
let shuttingDown = false;

const closeApp = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Shutting down backend");

  try {
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
};

process.on("SIGINT", () => {
  void closeApp("SIGINT");
});

process.on("SIGTERM", () => {
  void closeApp("SIGTERM");
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
