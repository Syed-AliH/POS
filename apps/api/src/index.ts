import './load-env';
import { buildApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
    app.log.info(`API listening on http://${config.API_HOST}:${config.API_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
