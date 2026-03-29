import {
	buildJsdelivrRelease,
	bumpVersion,
	formatReleaseSummary,
	getPackageVersion,
	gitStatusShort,
	gitTagExists,
	runCommand,
	updateProjectVersion,
} from './jsdelivr-lib.mjs';

function parseArgs(argv) {
	const options = {
		bump: 'patch',
		push: false,
		allowDirty: false,
		version: null,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];

		if (arg === '--push') {
			options.push = true;
			continue;
		}

		if (arg === '--allow-dirty') {
			options.allowDirty = true;
			continue;
		}

		if (arg === '--bump') {
			options.bump = argv[index + 1];
			index += 1;
			continue;
		}

		if (arg === '--version') {
			options.version = argv[index + 1];
			index += 1;
			continue;
		}

		throw new Error(`Unknown argument "${arg}".`);
	}

	return options;
}

const options = parseArgs(process.argv.slice(2));
const currentVersion = await getPackageVersion();
const nextVersion = options.version || bumpVersion(currentVersion, options.bump);

if (!options.allowDirty) {
	const status = await gitStatusShort();

	if (status) {
		throw new Error(
			[
				'Refusing to create a release from a dirty worktree.',
				'Commit or stash your changes first, or rerun with --allow-dirty.',
				'Current git status:',
				status,
			].join('\n')
		);
	}
}

if (await gitTagExists(nextVersion)) {
	throw new Error(`Git tag "${nextVersion}" already exists.`);
}

await updateProjectVersion(nextVersion);
const urls = await buildJsdelivrRelease(nextVersion);

const addArgs = ['git', 'add', 'package.json', 'dist/salla'];

try {
	await runCommand(['git', 'ls-files', '--error-unmatch', 'package-lock.json']);
	addArgs.push('package-lock.json');
} catch (error) {
	if (!/did not match any file/.test(String(error))) {
		throw error;
	}
}

await runCommand(addArgs, { stdio: 'inherit' });
await runCommand(
	['git', 'commit', '-m', `chore: release jsdelivr ${nextVersion}`],
	{ stdio: 'inherit' }
);
await runCommand(
	['git', 'tag', '-a', nextVersion, '-m', `jsdelivr release ${nextVersion}`],
	{ stdio: 'inherit' }
);

if (options.push) {
	await runCommand(['git', 'push', 'origin', 'HEAD', '--follow-tags'], {
		stdio: 'inherit',
	});
}

console.log(formatReleaseSummary(urls));
console.log(
	[
		'',
		'Manual purge note:',
		'  - Paste dist/salla/purge-urls.txt into https://www.jsdelivr.com/tools/purge',
		'  - The public purge flow is reCAPTCHA-gated, so this repo does not auto-purge by default.',
	].join('\n')
);
