// Imported first by each entry point, before any module can call fetch().
import { installFetchGuard, warnIfUnpatched } from "./brotli-guard.js";

installFetchGuard();
warnIfUnpatched();
