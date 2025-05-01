import { build } from '@kellnerd/userscript-bundler';

build({
	// default values below, you can leave out options unless you want to change them
	userscriptSourcePath: 'src/userscripts/',
	// bookmarkletSourcePath: null,
	// bookmarklets are optional and have to be enabled:
	bookmarkletSourcePath: './src/bookmarklets/',
	docSourcePath: 'doc/',
	outputPath: 'dist/',
	readmePath: 'README.md',
});
