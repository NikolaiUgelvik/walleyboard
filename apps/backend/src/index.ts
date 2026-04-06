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

  // Force exit so lingering handles (timers, sockets) don't keep the process
  // alive after cleanup has finished.
  process.exit();
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    void closeApp(signal);
  });
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
