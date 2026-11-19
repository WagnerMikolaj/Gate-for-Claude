import { loadConfig } from './config.mjs';
import { createGate } from './server.mjs';
try {
  const config = loadConfig(process.env, process.argv.includes('--demo'));
  const gate = createGate(config);
  gate.server.listen(config.port, config.host, () => {
    console.log(`AI Gate: ${config.origin} | ${config.demo ? 'DEMO: synthetic identity, local scanning only' : 'PRODUCTION: corporate SSO required'} | external AI: ${config.allowExternal ? 'enabled' : 'disabled'}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    gate.server.close(() => { gate.audit.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 35000).unref();
  });
} catch (error) {
  console.error(`Startup refused: ${error.message}`);
  process.exitCode = 1;
}
