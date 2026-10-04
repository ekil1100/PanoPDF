import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Effect } from 'effect';

const require = createRequire(import.meta.url);

// AppKit reads the application menu title from the bundle, not the menu label.
// Only update the project's development runtime; packaged apps use productName.
const prepare = Effect.try({
  try: () => {
    if (process.platform !== 'darwin') return;
    const plist = path.resolve(require('electron'), '../../Info.plist');
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('/usr/bin/plutil', ['-replace', key, '-string', 'PanoPDF', plist]);
    }
  },
  catch: (cause) => new Error('Failed to prepare the development application name', { cause }),
});

Effect.runSync(prepare);
