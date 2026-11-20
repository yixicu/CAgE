# Third-party dependency notices

This source repository uses the dependencies below. It does not redistribute node_modules or a packaged desktop binary. Distribution-specific notice review is still required before a binary release. Original Carnot code remains under its repository license. Dependencies retain their own licenses. No OpenWebUI or AI Scientist source or artwork was copied.

## Direct pinned dependencies

| Package | Version | License | Primary source |
| --- | --- | --- | --- |
| @codemirror/lang-markdown | 6.5.2 | MIT | https://code.haverbeke.berlin/codemirror/lang-markdown |
| @codemirror/state | 6.7.6 | MIT | https://code.haverbeke.berlin/codemirror/state |
| @codemirror/view | 6.43.14 | MIT | https://code.haverbeke.berlin/codemirror/view |
| @earendil-works/pi-agent-core | 1.2.0 | MIT | https://github.com/earendil-works/pi |
| @earendil-works/pi-ai | 1.2.0 | MIT | https://github.com/earendil-works/pi |
| @earendil-works/pi-coding-agent | 1.2.0 | MIT | https://github.com/earendil-works/pi |
| @playwright/test | 1.64.0 | Apache-2.0 | https://github.com/microsoft/playwright |
| @sveltejs/vite-plugin-svelte | 7.3.1 | MIT | https://github.com/sveltejs/vite-plugin-svelte |
| @tailwindcss/vite | 4.3.3 | MIT | https://github.com/tailwindlabs/tailwindcss |
| @types/node | 24.19.2 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| fastify | 5.12.5 | MIT | https://github.com/fastify/fastify |
| isomorphic-git | 1.44.2 | MIT | https://github.com/isomorphic-git/isomorphic-git |
| katex | 0.19.0 | MIT | https://github.com/KaTeX/KaTeX |
| markdown-it | 15.0.2 | MIT | markdown-it/markdown-it |
| pdfjs-dist | 6.4.299 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| svelte | 5.57.2 | MIT | https://github.com/sveltejs/svelte |
| svelte-check | 4.7.6 | MIT | https://github.com/sveltejs/language-tools |
| tailwindcss | 4.3.3 | MIT | https://github.com/tailwindlabs/tailwindcss |
| typebox | 1.3.27 | MIT | https://github.com/sinclairzx81/typebox |
| typescript | 6.0.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| vite | 8.3.4 | MIT | https://github.com/vitejs/vite |
| vitest | 5.0.4 | MIT | https://github.com/vitest-dev/vitest |

## Transitive dependencies

The exact dependency versions and integrity hashes are recorded in package-lock.json. Every one of the 381 locked dependency nodes has license metadata. The inventory includes optional platform packages that are not installed on this Linux host. Registry metadata is evidence of declared licensing, not a substitute for checking distribution contents and required notices before release.

Not all transitive dependencies are MIT. Declared licenses include Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, PSF-2.0, Unlicense, BlueOak-1.0.0, 0BSD, MIT AND Zlib, MIT AND BSD-3-Clause and MPL-2.0. LightningCSS 1.32.0 and 1.33.0 and their platform bindings declare MPL-2.0. Preserve the corresponding upstream license/notice files and review distribution obligations at release.

Installed packages retain their original license files in node_modules. This repository does not redistribute node_modules or claim to replace those files. The future product release must assemble the notices for the exact shipped artifacts, including bundled fonts and browser assets.

## Provenance and script handling

package-lock.json records official registry.npmjs.org tarball URLs and integrity hashes.  No claim of independently verifying every publisher signature is made. The verified installation uses --ignore-scripts. Dependency lifecycle scripts are disabled by the project .npmrc; do not enable them blindly.
