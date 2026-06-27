import './load-env';
import { buildApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    const port = config.API_PORT;
    const host = config.API_HOST;
    await app.listen({ host, port });
    console.log(`Server running on http://${host}:${port}`);
    app.log.info(`API listening on http://${host}:${port} (PORT=${process.env.PORT ?? '—'}, API_PORT=${process.env.API_PORT ?? '—'})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
