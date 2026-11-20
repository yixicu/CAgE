# Carnot Agent Engine (CAgE)

CAgE is a local-first research workspace for theoretical physics and mathematical reasoning. Investigate a hypothesis, follow the reasoning behind a result, and retain proofs, open questions, skills and strategies across research sessions. The default research interface is V4. Model-generated arguments require independent scientific review.

## Windows desktop

[Download the Windows x64 installer and SHA-256 checksum from Releases](https://github.com/yixicu/CAgE/releases/latest).

Run the setup executable and choose a parent folder. Setup creates a Carnot Agent Engine subfolder. Under **Advanced**, choose **I have one** to detect a compatible Node.js runtime or compatible project packages. Missing packages can be downloaded during installation. The basic physics knowledge map and desktop shortcut are optional. The desktop shell uses Microsoft Edge WebView2. This release is unsigned.

## Run in a browser

Use Node.js 24.19 or newer in the 24.x series and npm 11.9.0. From the project directory:

~~~sh
npm ci --ignore-scripts
npm run build
npm start
~~~

Open the loopback address printed by the server. On Windows, after installing the dependencies, you can also run the included PowerShell launcher:

~~~powershell
.\Start-CAgE.ps1 -Build
~~~

## Research and storage

1. Open **Settings → Models & connections** to connect a provider and choose a research model.
2. Start a research session and enter a hypothesis. The workspace keeps the project's sources, discussions and results together.
3. Open **cages** to explore skills, strategies and knowledge maps. The Maintenance Assistant can import existing records.
4. Under **Settings → Research → Storage folders**, choose separate locations for system logs and research outputs. Changes take effect after fully exiting and reopening CAgE. Existing files stay in their original folders.

The browser edition defaults to the application’s .carnot-data folder. The desktop edition defaults to workspace inside the installation directory. Use CARNOT_DATA_DIR to select a different launch workspace. Provider credentials stay with that workspace. Research requests use the model provider you configure.

## Documentation

- [Repository map](docs/REPOSITORY_MAP.md)
- [Knowledge maintenance and map transfer](docs/MAINTENANCE.md)
- [Desktop build instructions](desktop-packaging/README.md)
- [Local security boundaries](docs/SECURITY.md)
- [Third-party notices](docs/THIRD_PARTY_NOTICES.md)
- [MIT license](LICENSE)
