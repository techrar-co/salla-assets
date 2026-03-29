import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const currentFilePath = fileURLToPath(import.meta.url);
const buildDir = path.dirname(currentFilePath);

export const repoRoot = path.resolve(buildDir, '..');
export const packageJsonPath = path.join(repoRoot, 'package.json');
export const packageLockPath = path.join(repoRoot, 'package-lock.json');
export const snippetPath = path.join(
	repoRoot,
	'snippet',
	'salla-storefront-snippet.js'
);
export const distDir = path.join(repoRoot, 'dist', 'salla');
export const releasesDir = path.join(distDir, 'releases');
export const repoSlug = 'techrar-co/salla-assets';

export function assertSemver(version) {
	if (!/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error(
			`Expected a plain semver tag like 0.1.0. Received "${version}".`
		);
	}

	return version;
}

export function bumpVersion(version, bump) {
	assertSemver(version);

	const [major, minor, patch] = version.split('.').map(Number);

	switch (bump) {
		case 'major':
			return `${major + 1}.0.0`;
		case 'minor':
			return `${major}.${minor + 1}.0`;
		case 'patch':
			return `${major}.${minor}.${patch + 1}`;
		default:
			throw new Error(`Unsupported bump "${bump}". Use patch, minor, or major.`);
	}
}

export async function readJson(filePath) {
	return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function getPackageVersion() {
	const packageJson = await readJson(packageJsonPath);

	return assertSemver(packageJson.version);
}

export function releaseFilename(version) {
	assertSemver(version);

	return `salla-storefront-snippet.${version}.min.js`;
}

function renderBootstrapScript(src) {
	return `(function (w, d) {
	if (w.__techrarSallaBootstrapLoaded) return;
	w.__techrarSallaBootstrapLoaded = true;

	var s = d.createElement('script');
	s.src = ${JSON.stringify(src)};
	s.async = true;
	s.crossOrigin = 'anonymous';
	(d.head || d.documentElement).appendChild(s);
})(window, document);
`;
}

function renderCurrentScript(src, version) {
	return `(function (w, d) {
	if (w.__techrarSallaReleaseLoaded) return;
	w.__techrarSallaReleaseLoaded = true;
	w.__techrarSallaVersion = ${JSON.stringify(version)};

	var s = d.createElement('script');
	s.src = ${JSON.stringify(src)};
	s.async = true;
	s.crossOrigin = 'anonymous';
	(d.head || d.documentElement).appendChild(s);
})(window, document);
`;
}

export function getJsdelivrUrls(version) {
	assertSemver(version);

	const [major, minor] = version.split('.');
	const stableAlias = major === '0' ? `${major}.${minor}` : major;
	const versionedReleaseUrl = `https://cdn.jsdelivr.net/gh/${repoSlug}@${version}/dist/salla/releases/${releaseFilename(version)}`;
	const versionedCurrentUrl = `https://cdn.jsdelivr.net/gh/${repoSlug}@${version}/dist/salla/current.js`;
	const stableCurrentUrl = `https://cdn.jsdelivr.net/gh/${repoSlug}@${stableAlias}/dist/salla/current.js`;
	const latestCurrentUrl = `https://cdn.jsdelivr.net/gh/${repoSlug}@latest/dist/salla/current.js`;

	return {
		version,
		majorAlias: major,
		stableAlias,
		versionedReleaseUrl,
		versionedCurrentUrl,
		stableCurrentUrl,
		latestCurrentUrl,
		recommendedBootstrap: renderBootstrapScript(stableCurrentUrl),
		purgeUrls: [stableCurrentUrl, latestCurrentUrl],
	};
}

export async function buildJsdelivrRelease(version) {
	assertSemver(version);

	const source = await readFile(snippetPath, 'utf8');
	const minified = await minify(source, {
		compress: {
			passes: 2,
		},
		mangle: true,
		format: {
			comments: false,
		},
	});

	if (!minified.code) {
		throw new Error('Terser returned empty output.');
	}

	const urls = getJsdelivrUrls(version);
	const releasePath = path.join(releasesDir, releaseFilename(version));

	await mkdir(releasesDir, { recursive: true });

	await writeFile(releasePath, `${minified.code.trim()}\n`);
	await writeFile(
		path.join(distDir, 'current.js'),
		renderCurrentScript(urls.versionedReleaseUrl, version)
	);
	await writeFile(
		path.join(distDir, 'bootstrap.inline.js'),
		urls.recommendedBootstrap
	);
	await writeFile(path.join(distDir, 'purge-urls.txt'), `${urls.purgeUrls.join('\n')}\n`);
	await writeJson(path.join(distDir, 'release.json'), {
		version,
		generatedAt: new Date().toISOString(),
		urls,
	});

	return {
		...urls,
		releasePath,
	};
}

export async function updateProjectVersion(version) {
	assertSemver(version);

	const packageJson = await readJson(packageJsonPath);
	packageJson.version = version;
	await writeJson(packageJsonPath, packageJson);

	try {
		const packageLock = await readJson(packageLockPath);
		packageLock.version = version;

		if (packageLock.packages?.['']) {
			packageLock.packages[''].version = version;
		}

		await writeJson(packageLockPath, packageLock);
	} catch (error) {
		if (error?.code !== 'ENOENT') {
			throw error;
		}
	}
}

export async function runCommand(args, options = {}) {
	const { stdio = 'pipe' } = options;

	return new Promise((resolve, reject) => {
		const child = spawn(args[0], args.slice(1), {
			cwd: repoRoot,
			stdio,
		});

		let stdout = '';
		let stderr = '';

		if (stdio === 'pipe') {
			child.stdout?.on('data', (chunk) => {
				stdout += chunk.toString();
			});

			child.stderr?.on('data', (chunk) => {
				stderr += chunk.toString();
			});
		}

		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}

			reject(
				new Error(
					`${args.join(' ')} exited with code ${code}${
						stderr ? `\n${stderr.trim()}` : ''
					}`
				)
			);
		});
	});
}

export async function gitStatusShort() {
	const { stdout } = await runCommand(['git', 'status', '--short']);

	return stdout.trim();
}

export async function gitTagExists(tag) {
	const { stdout } = await runCommand(['git', 'tag', '--list', tag]);

	return stdout.trim() === tag;
}

export function formatReleaseSummary(urls) {
	return [
		`Version: ${urls.version}`,
		`Recommended Salla URL: ${urls.stableCurrentUrl}`,
		`Exact current.js URL: ${urls.versionedCurrentUrl}`,
		`Exact release URL: ${urls.versionedReleaseUrl}`,
		'Purge these alias URLs after push:',
		...urls.purgeUrls.map((url) => `  - ${url}`),
		'Inline bootstrap:',
		urls.recommendedBootstrap.trim(),
	].join('\n');
}
