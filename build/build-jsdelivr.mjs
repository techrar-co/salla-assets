import { buildJsdelivrRelease, formatReleaseSummary, getPackageVersion } from './jsdelivr-lib.mjs';

const version = await getPackageVersion();
const urls = await buildJsdelivrRelease(version);

console.log(formatReleaseSummary(urls));
