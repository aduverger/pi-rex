import { createJiti } from "jiti";

const alias = JSON.parse(process.argv.splice(2, 1)[0]);
await createJiti(import.meta.url, { alias }).import("./viewer.ts");
