# Mathsemble privacy and security notes (0.1.15 development)

- The application is local-first and does not implement analytics, telemetry, accounts, or application-managed cloud sync.
- The plugin reads the Markdown files used in the currently opened note or folder-based exam collection. It updates frontmatter after a direct user action to set a teaching role, or changes the current question heading after the user explicitly invokes the H5 conversion command. Preview and export do not rewrite source notes.
- The plugin may request external HTTP(S) resources when a rendered document references remote images/fonts. Remote hosts then see the ordinary request. The feature should not be described as fully offline when printing content that references external resources.
- The plugin can read explicitly referenced `file://` images/font resources located outside an Obsidian vault. The print routine writes temporary HTML to the operating-system temporary directory, then deletes that directory in its `finally` cleanup. Electron handles PDF generation locally.
- Exported PDFs/HTML are saved into the vault's `ExamExports/` folder and are not automatically shared externally by this plugin.
- The isolated Electron window uses `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Print content strips script, iframe and inline event attributes and restricts its CSP. Those safeguards mitigate risk but have not undergone an independent security audit.
- Acknowledged rendering failures can produce incomplete PDF content. Visible warnings and source-file review remain essential.
