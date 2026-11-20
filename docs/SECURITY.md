# Local application boundaries

Carnot is a single-user, local application. The backend listens on loopback only. Local request checks protect project-changing actions from unrelated web pages; this is not a remote multi-user authentication system.

Workers receive only explicitly authorized source reads and private note writes. No default Shell, arbitrary execution or nested-agent tool is exposed. These are application-level restrictions, not an operating-system sandbox. Only the bundled trusted example plugin is included; in-process plugins must be treated as trusted code.

Pi provider credentials and research data live in the application data directory. The default `.carnot-data/` folder is ignored by Git. Keep it out of archives and distribution packages, and restrict access to the local user account. An external workspace can be selected with `CARNOT_DATA_DIR`. Never attach real keys, session logs, private papers or full research prompts to an issue.

For a security concern, contact the repository owner through a private channel already available to you. Describe the behavior and affected version without publishing a working credential or private research content.
