import { inventory } from "../electron/system.mjs";
import { readProvider } from "../electron/providers.mjs";
const system = await inventory();
for (const id of ["cursor", "antigravity", "claude", "codex"]) {
  const result = await readProvider(id, system);
  console.log(JSON.stringify(result));
}
