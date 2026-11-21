# Local application boundaries

Carnot is a single-user, local application. The backend listens on loopback only. Local request checks protect project-changing actions from unrelated web pages; this is not a remote multi-user authentication system.

Workers receive only explicitly authorized source reads and private note writes. No default Shell, arbitrary execution or nested-agent tool is exposed. These are application-level restrictions, not an operating-system sandbox. In-process plugins are trusted code. The optional web search plugin sends V4 Theorist queries and selected URLs to the provider chosen in Settings. Enabling it covers all V4 projects except those explicitly excluded. Provider keys are stored in the launch workspace's credentials directory; exclude that directory when sharing workspaces.

Pi provider credentials and research data live in the application data directory. The default `.carnot-data/` folder is ignored by Git. Keep it out of archives and distribution packages, and restrict access to the local user account. An external workspace can be selected with `CARNOT_DATA_DIR`. Never attach real keys, session logs, private papers or full research prompts to an issue.

For a security concern, contact the repository owner through a private channel already available to you. Describe the behavior and affected version without publishing a working credential or private research content.
